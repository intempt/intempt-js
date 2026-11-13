import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { debounce } from '../../../shared/shared.utils.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { DeliveryFailure } from '../../../shared/queue/requestBatcher.ts';
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

/**
 * The batcher's flush interval (autoTracker.transport.ts): a kept never-reached
 * batch is retried no sooner than this (ruling R4).
 */
const KEPT_RETRY_MS = 5000;

/** Browsers reject keepalive bodies once a page has more than this in flight. */
const KEEPALIVE_BUDGET_BYTES = 64 * 1024;

/** A non-OK response from the track endpoint; `status` drives the retry decision. */
class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: string,
  ) {
    super(`HTTP error! Status: ${status}`);
  }
}

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
 * The **legacy** delivery path: an in-memory pool, a debounce, and unbatched `fetch`
 * calls (one per size-bounded chunk) per flush.
 *
 * Extracted from `autoTracker.module.ts` (the event-pool split); since then it keeps
 * and chunks a failed batch (INT-3883) and tells permanent from transient failures.
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
  /** Events already given their one 503/429 resend (INT-7436). */
  private readonly _resent = new WeakSet<PooledEvent>();
  /** Events whose `transport` failure was already reported (INT-7444: once per batch). */
  private readonly _transportReported = new WeakSet<PooledEvent>();
  /**
   * Not before this time does a regular flush send: a kept batch is waiting for
   * its retry, or a 503/429 for its Retry-After. A Leave Page flush ignores it,
   * being the last chance those events get.
   */
  private _waitUntil = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

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
      void this.flush(true);
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
   * the same events twice, and put back (INT-3883) when a POST fails transiently, so
   * the next flush retries it. Bounded by `MAX_POOLED_EVENTS`: during a long outage
   * the oldest events are dropped rather than growing memory without limit.
   *
   * Only transient failures are kept (network error, 408, 429, 5xx). A permanent
   * 4xx (400 malformed, 401/403 auth, 413 too large) would fail identically on every
   * retry and push good events out at the cap, so that chunk is dropped and logged.
   *
   * The batch goes out as chunks under the keepalive budget. A normal flush sends
   * them one after another and, on the first transient failure, puts the failed
   * chunk and every unsent one back, in order. An `unloading` flush (page leave)
   * cannot await between chunks, so it issues every fetch up front (keepalive only up to
   * the 64 KiB budget) and puts back whichever chunks failed transiently.
   */
  async flush(unloading = false): Promise<void> {
    if (this._pool.length === 0) return;
    const waitLeftMS = this._waitUntil - Date.now();
    if (!unloading && waitLeftMS > 0) {
      this._armRetry(waitLeftMS);
      return;
    }
    const batch = this._pool.splice(0, this._pool.length);
    const chunks = chunkBySize(batch, MAX_CHUNK_BYTES);

    if (unloading) {
      // Every fetch is issued synchronously, before the first await. Only as many chunks as fit
      // the keepalive budget get `keepalive`; the rest are sent without it, because the browser
      // would reject them outright. A non-keepalive fetch may be cut off if the page really is
      // unloading, but completes on a bfcache entry or a navigation that is called off, and a
      // chunk that fails is put back below like any other.
      let keepaliveBytes = 0;
      const results = await Promise.allSettled(
        chunks.map((chunk) => {
          const bytes = utf8Length(JSON.stringify({ track: chunk }));
          const keepalive = keepaliveBytes + bytes <= KEEPALIVE_BUDGET_BYTES;
          if (keepalive) keepaliveBytes += bytes;
          return this._post(chunk, keepalive);
        }),
      );
      const retained: PooledEvent[] = [];
      results.forEach((result, i) => {
        if (
          result.status === 'rejected' &&
          this._keep(result.reason, chunks[i])
        )
          retained.push(...chunks[i]);
      });
      this._requeue(retained);
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      try {
        await this._post(chunks[i]);
      } catch (error) {
        if (this._keep(error, chunks[i])) {
          this._requeue(chunks.slice(i).flat());
          return;
        }
        // Permanent rejection: drop this chunk, carry on with the rest.
      }
    }
  }

  /**
   * The CONTRACT-R2 §S1 table for the fallback path. True keeps the chunk:
   * never reached the server, or a 503/429 not yet resent (resent at the next
   * flush, after Retry-After clamped to 1–60 s). Everything else is dropped
   * and reported through `onDeliveryFailure`.
   */
  private _keep(error: unknown, chunk: PooledEvent[]): boolean {
    const status = error instanceof HttpStatusError ? error.status : undefined;
    if (status === undefined) {
      log.error('_sendTrackEventData never reached the server, kept', error);
      if (chunk.some((e) => !this._transportReported.has(e))) {
        chunk.forEach((e) => this._transportReported.add(e));
        this._report({ kind: 'transport', terminal: false }, chunk);
      }
      this._waitFor(KEPT_RETRY_MS);
      return true;
    }
    const seconds = parseInt((error as HttpStatusError).retryAfter ?? '', 10);
    const retryAfter = Number.isFinite(seconds) ? seconds : undefined;
    if (
      (status === 503 || status === 429) &&
      !chunk.some((e) => this._resent.has(e))
    ) {
      chunk.forEach((e) => this._resent.add(e));
      const waitMS = Math.min(60_000, Math.max(1000, (retryAfter ?? 0) * 1000));
      this._waitFor(waitMS);
      log.error(`_sendTrackEventData got ${status}, one resend`, error);
      return true;
    }
    log.error('_sendTrackEventData failed, dropping events', error);
    this._report(
      {
        kind: 'terminal',
        status,
        terminal: true,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      },
      chunk,
    );
    return false;
  }

  private _report(
    failure: Omit<DeliveryFailure, 'eventCount' | 'eventIds'>,
    chunk: PooledEvent[],
  ): void {
    const listener = this._config.onDeliveryFailure;
    if (!listener) return;
    const eventIds = chunk.flatMap((e) =>
      Array.isArray(e.payload)
        ? (e.payload as Array<{ eventId?: unknown }>)
            .map((p) => p?.eventId)
            .filter((id): id is string => typeof id === 'string')
        : [],
    );
    try {
      listener({ ...failure, eventCount: chunk.length, eventIds });
    } catch (error) {
      log.error('onDeliveryFailure listener threw', error);
    }
  }

  /** Hold regular flushes for `ms`, never shortening a longer wait already set. */
  private _waitFor(ms: number): void {
    const until = Date.now() + ms;
    if (until <= this._waitUntil) return;
    this._waitUntil = until;
    this._armRetry(ms);
  }

  private _armRetry(ms: number): void {
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      void this.flush();
    }, ms);
  }

  /**
   * Put events back at the front of the pool, trimmed to the cap (oldest
   * dropped and reported as `dropped`).
   */
  private _requeue(events: PooledEvent[]): void {
    this._pool.unshift(...events);
    if (this._pool.length > MAX_POOLED_EVENTS) {
      const dropped = this._pool.splice(
        0,
        this._pool.length - MAX_POOLED_EVENTS,
      );
      log.error(
        `fallback pool cap reached, ${dropped.length} event(s) dropped`,
      );
      this._report({ kind: 'dropped', terminal: true }, dropped);
    }
  }

  /** One POST. Throws on a thrown fetch or a non-OK response. `fetch` is issued before the first await. */
  private async _post(events: PooledEvent[], keepalive = true): Promise<void> {
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
      keepalive,
    });

    if (!response.ok) {
      throw new HttpStatusError(
        response.status,
        response.headers?.get?.('Retry-After') ?? undefined,
      );
    }
  }
}
