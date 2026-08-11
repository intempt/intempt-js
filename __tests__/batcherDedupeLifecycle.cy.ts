import { RequestBatcher } from '../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../src/shared/storage/queueStorage.ts';
import {
  DO_NOT_TRACK_KEY,
  loadDoNotTrack,
  persistDoNotTrack,
} from '../src/shared/consentState.ts';

/**
 * Regression cover for the three live defects recorded in
 * docs/sdk-hardening/CHECKPOINT.md §4:
 *
 *   1. itemIdsSentSuccessfully was never pruned      -> memory leak
 *   2. the unloading branch never dequeued           -> duplicate sends / zombie items
 *   3. optIn/optOut were in-memory only              -> opt-out reset on reload
 */

const STORAGE_KEY = '__test_dedupe_batcher__';
const SENT_IDS_KEY = `${STORAGE_KEY}_sent_event_ids`;

/** Payload shape the batcher's extractEventIds() understands. */
function event(eventId: string) {
  return { name: 'Test Event', payload: [{ eventId, sessionId: 's', profileId: 'p' }] };
}

describe('RequestBatcher dedupe lifecycle', () => {
  let batcher: RequestBatcher;
  let sendRequestCalls: any[];
  let nextResponse: any;

  function makeBatcher() {
    return new RequestBatcher({
      storageKey: STORAGE_KEY,
      libConfig: {
        batchSize: 10,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false,
      },
      sendRequestFunc: async (data, options) => {
        sendRequestCalls.push({ data, options });
        return nextResponse;
      },
      usePersistence: true,
      queueStorage: new QueueStorage(),
    });
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SENT_IDS_KEY);
    sendRequestCalls = [];
    nextResponse = { httpStatusCode: 200, ok: true };
    batcher = makeBatcher();
  });

  afterEach(async () => {
    batcher.stop();
    await batcher.clear();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SENT_IDS_KEY);
  });

  // --- Defect 1: unbounded dedupe structures --------------------------------

  it('drops the per-item attempt counter once the item is removed from the queue', async () => {
    for (let i = 0; i < 5; i++) {
      await batcher.enqueue(event(`evt-${i}`));
    }
    await batcher.flush();

    expect(sendRequestCalls.length).to.equal(1);
    // Every item was delivered and removed, so nothing needs remembering.
    expect((batcher as any).itemIdsSentSuccessfully.size).to.equal(0);
  });

  it('keeps the attempt counter only while removal keeps failing', async () => {
    await batcher.enqueue(event('evt-stuck'));
    // Force removal to fail so the item stays in the queue and must be counted.
    (batcher as any).removeItemsFromQueue = async () => false;

    await batcher.flush();

    const counters = (batcher as any).itemIdsSentSuccessfully as Map<string, number>;
    expect(counters.size).to.equal(1);
    expect(Array.from(counters.values())[0]).to.equal(1);
  });

  it('caps the in-memory sent-event-id set', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `bulk-${i}`);
    (batcher as any).markEventIdsSent(ids);

    const sent: Set<string> = (batcher as any).sentEventIds;
    expect(sent.size).to.equal(1000);
    // Oldest evicted, newest retained.
    expect(sent.has('bulk-0')).to.be.false;
    expect(sent.has('bulk-1499')).to.be.true;
  });

  it('trims an over-sized persisted set on load', () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `stored-${i}`);
    localStorage.setItem(SENT_IDS_KEY, JSON.stringify(ids));

    const fresh = makeBatcher();
    expect(((fresh as any).sentEventIds as Set<string>).size).to.equal(1000);
    fresh.stop();
  });

  // --- Defect 2: the unloading branch ---------------------------------------

  it('dequeues on unload when the server definitely accepted the batch', async () => {
    await batcher.enqueue(event('evt-unload-ok'));
    nextResponse = { httpStatusCode: 200, ok: true };

    await batcher.flush({ unloading: true });

    expect(sendRequestCalls.length).to.equal(1);
    const remaining = await (batcher as any).queue.fillBatch(10);
    expect(remaining.length).to.equal(0);
  });

  it('keeps the batch queued on unload when the outcome is unknown', async () => {
    await batcher.enqueue(event('evt-unload-unknown'));
    nextResponse = { error: 'timeout', httpStatusCode: 0 };

    await batcher.flush({ unloading: true });

    // Losing events is worse than a possible duplicate, so it stays queued.
    const remaining = await (batcher as any).queue.fillBatch(10);
    expect(remaining.length).to.equal(1);
  });

  it('evicts already-sent items instead of skipping them forever', async () => {
    await batcher.enqueue(event('evt-already'));
    // Simulate the id having been marked sent by a previous page load.
    (batcher as any).markEventIdsSent(['evt-already']);

    await batcher.flush();

    // Nothing sent (correct — it is a duplicate) AND nothing left behind to
    // block the head of the queue on every future flush.
    expect(sendRequestCalls.length).to.equal(0);
    const remaining = await (batcher as any).queue.fillBatch(10);
    expect(remaining.length).to.equal(0);
  });

  it('does not let an evicted item stop the rest of the batch from sending', async () => {
    await batcher.enqueue(event('evt-dupe'));
    await batcher.enqueue(event('evt-fresh'));
    (batcher as any).markEventIdsSent(['evt-dupe']);

    await batcher.flush();

    expect(sendRequestCalls.length).to.equal(1);
    expect(sendRequestCalls[0].data.length).to.equal(1);
    expect(sendRequestCalls[0].data[0].payload[0].eventId).to.equal('evt-fresh');
  });
});

// --- Defect 3: persisted opt-out --------------------------------------------

describe('Persisted opt-out state', () => {
  afterEach(() => {
    localStorage.removeItem(DO_NOT_TRACK_KEY);
  });

  it('defaults to tracking allowed when nothing is stored', () => {
    localStorage.removeItem(DO_NOT_TRACK_KEY);
    expect(loadDoNotTrack()).to.be.false;
  });

  it('survives a reload after opt-out', () => {
    persistDoNotTrack(true);
    // A fresh read is what the next page load does.
    expect(loadDoNotTrack()).to.be.true;
  });

  it('lets an explicit opt-in clear a stored opt-out', () => {
    persistDoNotTrack(true);
    persistDoNotTrack(false);
    expect(loadDoNotTrack()).to.be.false;
  });

  it('treats a corrupt stored value as tracking allowed', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, '{not json');
    expect(loadDoNotTrack()).to.be.false;
  });
});
