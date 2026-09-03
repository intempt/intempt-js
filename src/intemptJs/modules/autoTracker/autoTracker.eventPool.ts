import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { debounce } from '../../../shared/shared.utils.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { buildTrackUrl } from './autoTracker.url.ts';

const log = createLogger('AutoTracker');

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
 * logged and dropped, and nothing is retried.
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
   * "Leave Page" debounces at 0 ms rather than 1000 ms because the page is on its
   * way out and a one-second wait means the event is never sent at all.
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
    const debouncedSendEvents = debounce(
      () => this.flush(),
      name === 'leave page' ? 0 : 1000,
    );

    return debouncedSendEvents();
  }

  clear() {
    this._pool.length = 0;
  }

  /** POST everything pooled, then empty the pool. Never throws. */
  async flush(): Promise<void> {
    if (this._pool.length === 0) return;
    /**
     * Make deep copy of the eventPool
     * */
    const data = JSON.parse(JSON.stringify(this._pool));

    this.clear();

    const { writeKey } = this._config;

    const url = buildTrackUrl(this._api, this._config);

    const [username, password] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    try {
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
    } catch (error) {
      log.error('_sendTrackEventData failed', error);
    }
  }
}
