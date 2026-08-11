import { beforeEach, describe, expect, it } from 'vitest';
import { RequestBatcher } from '../../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

const KEY = '__unit_invariants__';

/**
 * Property tests over random enqueue/flush/failure interleavings.
 *
 * Phase 2 of the hardening programme calls for this specifically, and Mixpanel's
 * suite has no equivalent. The reason it earns its place: the batcher's
 * correctness is a property of *sequences* of operations under failure, and
 * example-based tests only ever probe the sequences someone thought to write
 * down. The invariants below are the two that matter to a customer:
 *
 *   NO LOSS  — an event accepted by enqueue() is eventually delivered, or is
 *              still in the queue waiting. It never silently disappears.
 *   NO DUPES — no event id is delivered to the transport twice.
 *
 * Failures are deterministic given the seed printed in the assertion message, so
 * a red run is reproducible rather than a mystery.
 */

/** Small deterministic PRNG (mulberry32) — Math.random gives unreproducible failures. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function event(eventId: string) {
  return { name: 'Fuzz Event', payload: [{ eventId, sessionId: 's', profileId: 'p' }] };
}

interface RunResult {
  enqueued: string[];
  delivered: string[];
  stillQueued: string[];
}

async function runScenario(seed: number, steps: number): Promise<RunResult> {
  const random = rng(seed);
  const enqueued: string[] = [];
  const delivered: string[] = [];

  const batcher = new RequestBatcher({
    storageKey: KEY,
    libConfig: {
      batchSize: 1 + Math.floor(random() * 5),
      batchFlushIntervalMs: 1000,
      batchRequestTimeoutMs: 5000,
      batchAutostart: false,
    },
    sendRequestFunc: async (data: any[]) => {
      const roll = random();

      // 15% network failure, 10% server error, 5% timeout — the transport is
      // hostile, which is the only interesting case.
      if (roll < 0.15) {
        return { error: 'network error', httpStatusCode: 0 };
      }
      if (roll < 0.25) {
        return { httpStatusCode: 503, ok: false };
      }
      if (roll < 0.3) {
        return { error: 'timeout', httpStatusCode: 0 };
      }

      for (const item of data) {
        for (const entry of item.payload ?? []) {
          delivered.push(entry.eventId);
        }
      }
      return { httpStatusCode: 200, ok: true };
    },
    usePersistence: true,
    queueStorage: new QueueStorage(),
  });

  for (let step = 0; step < steps; step++) {
    const action = random();

    if (action < 0.6) {
      const id = `s${seed}-e${step}`;
      await batcher.enqueue(event(id));
      enqueued.push(id);
    } else if (action < 0.95) {
      await batcher.flush();
    } else {
      await batcher.flush({ unloading: true });
    }
  }

  // Drain: give the batcher enough successful attempts to clear whatever is
  // left, so "still queued" means genuinely stuck rather than merely unflushed.
  for (let i = 0; i < 40; i++) {
    await batcher.flush();
  }

  const stillQueued: string[] = [];
  for (const item of await (batcher as any).queue.fillBatch(1000)) {
    for (const entry of item.payload?.payload ?? []) {
      stillQueued.push(entry.eventId);
    }
  }

  batcher.stop();
  return { enqueued, delivered, stillQueued };
}

describe('queue invariants under random interleavings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const seeds = [1, 7, 42, 1337, 90210, 2026];

  it.each(seeds)('never delivers the same event twice (seed %i)', async seed => {
    const { delivered } = await runScenario(seed, 60);

    const seen = new Set<string>();
    const duplicates = delivered.filter(id => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });

    expect(duplicates, `seed ${seed} delivered duplicates: ${duplicates.join(', ')}`).toEqual([]);
  });

  it.each(seeds)('never loses an accepted event (seed %i)', async seed => {
    const { enqueued, delivered, stillQueued } = await runScenario(seed, 60);

    const accounted = new Set([...delivered, ...stillQueued]);
    const lost = enqueued.filter(id => !accounted.has(id));

    expect(lost, `seed ${seed} lost: ${lost.join(', ')}`).toEqual([]);
  });

  it('delivers everything when the transport is healthy', async () => {
    localStorage.clear();
    const delivered: string[] = [];
    const batcher = new RequestBatcher({
      storageKey: KEY,
      libConfig: {
        batchSize: 3,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false,
      },
      sendRequestFunc: async (data: any[]) => {
        for (const item of data) {
          for (const entry of item.payload ?? []) {
            delivered.push(entry.eventId);
          }
        }
        return { httpStatusCode: 200, ok: true };
      },
      usePersistence: true,
      queueStorage: new QueueStorage(),
    });

    const ids = Array.from({ length: 25 }, (_, i) => `healthy-${i}`);
    for (const id of ids) {
      await batcher.enqueue(event(id));
    }
    await batcher.flush();

    expect(delivered.sort()).toEqual([...ids].sort());
    batcher.stop();
  });
});
