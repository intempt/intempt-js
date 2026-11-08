import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { debounce } from '../../../shared/shared.utils.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { buildTrackUrl } from './autoTracker.url.ts';

const log = createLogger('AutoTracker');

/** Cap on events held in memory across failed flushes (INT-3883). */
const MAX_POOLED_EVENTS = 1000;

/**
 * Max serialized size of one POST body. Browsers reject a `keepalive` request that
 * would take the page's in-flight keepalive bodies over 64 KiB (see
 * `KEEPALIVE_BUDGET_BYTES` in `autoTracker.transport.ts`). A retained backlog can be
 * far larger than that, so it is sent as sequential chunks under the budget, with
 * headroom for the `{"track":[...]}` envelope. A single event larger than this still
 * goes alone: it cannot be split.
 */
const MAX_CHUNK_BYTES = 48 * 1024;

function utf8Length(text: string): number {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(text).length
    : text.length * 3; // Worst case, so the budget is never overrun.
}

/** Split events into consecutive chunks whose serialized size stays under `maxBytes`. */
function chunkBySize(events: PooledEvent[], maxBytes: number): PooledEvent[][] {
  const chunks: PooledEvent[][] = [];
  let current: PooledEvent[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const bytes = utf8Length(JSON.stringify(event)) + 1; // +1 for the separating comma
    if (current.length > 0 && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Shape common to every event model that reaches the pool. Only `name` is ever
 * read here — the rest travels opaquely through `JSON.stringify`, hence the index
 * signature.
 */
export type PooledEvent = {
  name: string;
  type?: string;
  [key: string]: unknown;
};

/**
 * The **legacy** delivery path: an in-memory pool, a debounce, and one unbatched
 * `fetch` per flush.
 *
 * Extracted from `autoTracker.module.ts` (the event-pool split), unchanged.
 *
 * **This is the fallback, not the main path.** Everything normally goes through
 * `AutoTrackerTransport`'s batcher, which has persistence, jittered retries, a
 * circuit breaker and a bounded queue. The pool is what runs when the batcher
 * failed to initialise at all — a storage tier that will not open, typically — and
 * it has none of those properties: events live only in memory, a failed POST is
 * logged and the batch is kept (capped) for the next flush, with no backoff.
 *
 * Keeping it is still right, because "no batcher" would otherwise mean "no
 * tracking". Isolating it makes the difference in guarantees visible instead of
 * interleaved with the batcher's code, and it is now the obvious place to look when
 * asking why a small number of customers see no retries.
 */
export class AutoTrackerEventPool {
  private readonly _config: IntemptConfig;
  private readonly _api: string;
  private readonly _pool: PooledEvent[] = [];

  constructor(config: IntemptConfig, api: string) {
    this._config = config;
    this._api = api;
  }

  /** Test/diagnostic seam: how many events are waiting in memory. */
  get size(): number {
    return this._pool.length;
  }

  /**
   * Add an event and schedule a flush.
   *
   * "Leave Page" skips the debounce and flushes synchronously, because the page
   * is on its way out and even a 0 ms timer may never fire.
   */
  push(data: PooledEvent) {
    const name = data.name.toLowerCase();
    this._pool.push(data);

    // NOTE (pre-existing): a fresh `debounce` is created per call, so the timer is
    // never actually shared between calls and the "debounce" does not coalesce
    // anything — each event schedules its own flush. Preserved exactly rather than
    // fixed, because the flush drains the whole pool, so the observable effect is
    // extra no-op flushes rather than lost or duplicated events. Do not "fix" this
    // without a test that pins the resulting request count.
    //
    // "Leave Page" is flushed synchronously, not through a 0 ms timer: it runs
    // inside an unload handler, and a page on its way out may never get to the
    // next task (INT-5942). `flush()` issues its fetch before its first await.
    if (name === 'leave page') {
      void this.flush();
      return;
    }
    const debouncedSendEvents = debounce(() => this.flush(), 1000);

    return debouncedSendEvents();
  }

  clear() {
    this._pool.length = 0;
  }

  /**
   * POST everything pooled. Never throws.
   *
   * The batch is taken out of the pool up front so a concurrent flush cannot send
   * the same events twice, and put back (INT-3883) when a POST fails, so the next
   * flush retries it. Bounded by `MAX_POOLED_EVENTS`: during a long outage the oldest
   * events are dropped rather than growing memory without limit.
   *
   * The batch goes out as sequential chunks under the keepalive budget, so a backlog
   * built up during an outage still drains instead of being rejected whole on every
   * flush. On the first failure the failed chunk and every chunk not yet sent are put
   * back, in order; chunks already delivered are not re-sent.
   */
  async flush(): Promise<void> {
    if (this._pool.length === 0) return;
    const batch = this._pool.splice(0, this._pool.length);
    const chunks = chunkBySize(batch, MAX_CHUNK_BYTES);

    for (let i = 0; i < chunks.length; i++) {
      try {
        await this._post(chunks[i]);
      } catch (error) {
        log.error('_sendTrackEventData failed', error);
        this._pool.unshift(...chunks.slice(i).flat());
        if (this._pool.length > MAX_POOLED_EVENTS) {
          this._pool.splice(0, this._pool.length - MAX_POOLED_EVENTS);
        }
        return;
      }
    }
  }

  /** One POST. Throws on a thrown fetch or a non-OK response. `fetch` is issued before the first await. */
  private async _post(events: PooledEvent[]): Promise<void> {
    /**
     * Make deep copy of the eventPool
     * */
    const data = JSON.parse(JSON.stringify(events));

    const { writeKey } = this._config;

    const url = buildTrackUrl(this._api, this._config);

    const [username, password] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${encodedCredentials}`,
      },
      body: JSON.stringify({ track: data }),
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
  }
}
