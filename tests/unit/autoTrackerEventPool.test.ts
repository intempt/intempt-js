import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerEventPool } from '../../src/intemptJs/modules/autoTracker/autoTracker.eventPool.ts';
import { IntemptConfig } from '../../src/intemptJs/types/intemptJs.types.ts';

/**
 * `autoTracker.eventPool.ts` — `AUDIT.md` §1c tier 1, item 4. **0.00% mutation score
 * and 17.4% line coverage on arrival: every mutant uncovered.**
 *
 * The reason it is tier 1 despite being 23 lines: **this is the code that runs when
 * everything else has already failed.** The pool is the fallback delivery path, used
 * when `AutoTrackerTransport`'s batcher could not initialise — typically a storage
 * tier that will not open. It has none of the batcher's properties: no persistence,
 * no retry, no circuit breaker, no bound. So the code that runs in the
 * already-degraded case was the code with no tests, which is the wrong way round.
 *
 * What these tests are really pinning is the **difference in guarantees**. One
 * assertion below looks like it asserts a bug (every `push` schedules its own
 * flush). It asserts the documented fallback contract, and says so. A failed POST
 * keeps the batch for the next flush (INT-3883, bounded, sent in chunks under the
 * keepalive budget); that is asserted as the intended behaviour, not as a bug.
 * Read the source comments before "fixing" any of them.
 */

const API = 'https://api.example.com/v1';

const CONFIG = {
  organization: 'acme',
  project: 'proj-1',
  sourceId: 'src-1',
  writeKey: 'user-part.password-part',
  shopify: false,
  magento: false,
} as IntemptConfig;

// `?ip=1` asks the platform to derive country/region/city from the address the request
// arrives on. The browser no longer looks that up itself. `?ip=0` when the customer sets
// useIpAddressForGeolocation: false.
const TRACK_URL = `${API}/acme/projects/proj-1/sources/src-1/track?ip=1`;

function okResponse() {
  return { ok: true, status: 200 };
}

/** The last `fetch` call's parsed JSON body. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('push and the debounce window', () => {
  it('holds an ordinary event for a second before flushing', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });

    expect(pool.size).toBe(1);
    // 999 ms is deliberately one tick short: the boundary is the whole behaviour,
    // and `>= 1000` vs `> 1000` is a mutation nothing else would catch.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  it('flushes "Leave Page" immediately instead, because the page is going away', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Leave Page' });

    // 0 ms, not 1000: a one-second wait on an unloading page means the event is
    // never sent at all. This is the single most load-bearing branch in the file.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends "Leave Page" inside the call, without waiting for any timer (INT-5942)', () => {
    // push() runs inside a pagehide/beforeunload handler. An unloading page may
    // never reach the next task, so even a 0 ms timer can be too late.
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Leave Page' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  it('matches the leave-page name case-insensitively', () => {
    // `data.name.toLowerCase()` is compared against the lowercase literal. A
    // customer-visible event name is capitalised, so dropping the `toLowerCase()`
    // would silently put every unload event back on the 1000 ms path.
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'LEAVE PAGE' });

    vi.advanceTimersByTime(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drains everything pooled so far in one request', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'A' });
    pool.push({ name: 'B' });
    pool.push({ name: 'C' });
    expect(pool.size).toBe(3);

    await vi.advanceTimersByTimeAsync(1000);

    // One flush carries all three. The extra timers fire against an empty pool.
    expect(bodyOf(fetchMock).track).toHaveLength(3);
  });

  /**
   * **Pinned bug, documented in the source: the debounce does not debounce.**
   *
   * `push()` constructs a *fresh* `debounce` per call, so no timer is ever shared
   * and nothing coalesces — each event schedules its own flush. The observable
   * effect is extra no-op flushes rather than lost or duplicated events, because
   * the first flush drains the pool and the rest return early on
   * `this._pool.length === 0`.
   *
   * This test is what the source comment asks for: **do not "fix" the debounce
   * without a test pinning the resulting request count.** This is that test, and it
   * will fail when the fix lands — which is the point.
   */
  it('schedules one timer per push, and the later ones flush nothing (known)', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'A' });
    pool.push({ name: 'B' });

    await vi.advanceTimersByTimeAsync(1000);

    // Two timers fired; only the first found anything to send.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).track).toHaveLength(2);
  });
});

describe('flush — the request it builds', () => {
  it('does nothing at all when the pool is empty', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    await pool.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the org/project/source track path', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock.mock.calls[0][0]).toBe(TRACK_URL);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('sends ip=0 when the customer turns geolocation off', async () => {
    const pool = new AutoTrackerEventPool(
      { ...CONFIG, useIpAddressForGeolocation: false } as IntemptConfig,
      API,
    );
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API}/acme/projects/proj-1/sources/src-1/track?ip=0`,
    );
  });

  it('sends ip=1 when the option is absent, so the default is geolocation on', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock.mock.calls[0][0]).toContain('?ip=1');
  });

  it('splits the write key on the dot into Basic credentials', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    // `writeKey` is `user.password`; the header is base64 of `user:password`.
    // Getting the separator wrong authenticates as nobody and every event 401s.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      `Basic ${btoa('user-part:password-part')}`,
    );
  });

  it('sends keepalive, so an unload flush survives the navigation', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Leave Page' });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe(
      'application/json',
    );
  });

  it('nests the events under a `track` key', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view', type: 'auto', extra: 1 });
    await vi.advanceTimersByTimeAsync(1000);

    // The wire shape, and it is the same envelope the batcher uses — a difference
    // here would mean the fallback path delivers something ingest cannot read.
    expect(bodyOf(fetchMock)).toEqual({
      track: [{ name: 'Page view', type: 'auto', extra: 1 }],
    });
  });

  /**
   * **The deep copy is later than it looks, and the window matters.**
   *
   * `flush()` does `JSON.parse(JSON.stringify(this._pool))` — but at *flush* time,
   * not at push time. The pool holds the caller's object **by reference** for the
   * whole debounce window, so an event mutated during that second is sent mutated.
   * The copy only isolates the payload from mutations that happen after the flush
   * has begun.
   *
   * Both halves are asserted below, because the first is the surprising one: an
   * auto-tracker that reuses one event object between pushes would send the last
   * state for all of them. Nothing in the SDK does that today; this pins the
   * property so a future caller that does is a failing test rather than a data bug.
   */
  it("holds the caller's object by reference until flush, so a mutation inside the debounce window is sent", async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    const event: Record<string, unknown> = {
      name: 'Page view',
      nested: { keep: 'original' },
    };
    pool.push(event as never);

    (event.nested as Record<string, string>).keep = 'mutated';
    await vi.advanceTimersByTimeAsync(1000);

    expect(bodyOf(fetchMock).track[0].nested.keep).toBe('mutated');
  });

  it('but snapshots the pool at flush time, so a mutation after that cannot ride along', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    const event: Record<string, unknown> = {
      name: 'Page view',
      nested: { keep: 'original' },
    };
    pool.push(event as never);
    await vi.advanceTimersByTimeAsync(1000);

    (event.nested as Record<string, string>).keep = 'mutated';

    // The request body was serialised from the copy, not from the live object.
    expect(bodyOf(fetchMock).track[0].nested.keep).toBe('original');
  });
});

describe('failure behaviour — the guarantees this path does NOT have', () => {
  it('swallows a rejected fetch rather than throwing into the caller', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });

    // An analytics SDK must never break the page that embeds it. `flush()` is
    // documented as "never throws" and this is the assertion behind that sentence.
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
  });

  it('swallows a non-2xx response too', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const pool = new AutoTrackerEventPool(CONFIG, API);

    pool.push({ name: 'Page view' });
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
  });

  /**
   * INT-3883: the pool used to be cleared *before* the `await`, so a failed POST lost
   * the batch permanently. It is now put back on failure (bounded, so an outage
   * cannot grow memory without limit) and goes out with the next flush. Persistence
   * and jittered retries are still the batcher's job, not this fallback's.
   */
  it('keeps the batch after a rejected fetch and re-sends it on the next flush', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(pool.size).toBe(1);

    fetchMock.mockClear();
    await pool.flush();
    expect(bodyOf(fetchMock).track).toEqual([{ name: 'Page view' }]);
    expect(pool.size).toBe(0);
  });

  it('keeps the batch after a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(pool.size).toBe(1);
  });

  it('puts the failed batch back in front of events pushed while it was in flight', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'A' });
    const inFlight = pool.flush();
    pool.push({ name: 'B' });
    await inFlight;

    fetchMock.mockClear();
    await pool.flush();
    expect(
      bodyOf(fetchMock).track.map((e: { name: string }) => e.name),
    ).toEqual(['A', 'B']);
  });

  it('bounds the retained batch during a long outage, dropping the oldest', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const pool = new AutoTrackerEventPool(CONFIG, API);
    for (let i = 0; i < 1200; i++) pool.push({ name: `E${i}` });
    await pool.flush();

    expect(pool.size).toBe(1000);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse());
    await pool.flush();
    const sent = bodyOf(fetchMock).track;
    expect(sent[0].name).toBe('E200');
    expect(sent[999].name).toBe('E1199');
  });

  it('sends a large backlog as several chunks, each under the 64 KiB keepalive budget', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const pool = new AutoTrackerEventPool(CONFIG, API);
    const pad = 'x'.repeat(2000);
    for (let i = 0; i < 100; i++) pool.push({ name: `E${i}`, pad });
    await pool.flush(); // fails: the whole backlog (~200 KB) is retained
    expect(pool.size).toBe(100);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(okResponse());
    await pool.flush();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const names: string[] = [];
    for (const call of fetchMock.mock.calls) {
      expect(new TextEncoder().encode(call[1].body).length).toBeLessThan(64 * 1024);
      for (const e of JSON.parse(call[1].body).track) names.push(e.name);
    }
    expect(names).toEqual(Array.from({ length: 100 }, (_, i) => `E${i}`));
    expect(pool.size).toBe(0);
  });

  it('re-queues the failed chunk and the unsent ones, but not chunks already delivered', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    const pad = 'x'.repeat(2000);
    for (let i = 0; i < 100; i++) pool.push({ name: `E${i}`, pad });
    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce({ ok: false, status: 503 });
    await pool.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2); // stopped at the first failure
    const delivered = JSON.parse(fetchMock.mock.calls[0][1].body).track.length;
    expect(pool.size).toBe(100 - delivered);
  });

  it('empties the pool after a successful POST', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'Page view' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(pool.size).toBe(0);
  });
});

describe('clear', () => {
  it('empties the pool without sending anything', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'A' });
    pool.push({ name: 'B' });

    pool.clear();
    expect(pool.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the pool reusable afterwards', async () => {
    const pool = new AutoTrackerEventPool(CONFIG, API);
    pool.push({ name: 'A' });
    pool.clear();

    pool.push({ name: 'B' });
    await vi.advanceTimersByTimeAsync(1000);

    // `_pool.length = 0` truncates in place rather than rebinding, so the array
    // the class holds is still the one `push` writes to.
    expect(bodyOf(fetchMock).track).toEqual([{ name: 'B' }]);
  });
});
