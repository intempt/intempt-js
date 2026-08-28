import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Golden-file contract tests on the **outbound wire payload**.
 *
 * **Why this file exists, specifically.** `BACKEND.md` item 4 ($lib_version) has
 * been blocked for the whole programme on a single problem: nobody could state
 * the wire format with confidence. CHECKPOINT §2 task 2 says it outright —
 * "Ingest may reject or silently drop unknown fields… Do not ship this blind".
 * The reason it could not be stated is that the format is not written down
 * anywhere; it is an emergent property of eight model classes, whichever ids the
 * trackers happen to resolve, and `JSON.stringify` silently dropping every
 * `undefined` field on the way out. This file pins it, so a change to any of
 * those is a failing test rather than a discovery in production.
 *
 * **These are recordings, not aspirations.** Several things in the goldens are
 * arguably wrong — a commented-out `timestamp` in every model, `record` and
 * `product` events with no `name` on the wire, `group` defaulting to
 * `'Identify'`. They are recorded exactly as they ship. The value is entirely in
 * accuracy: a golden that describes a payload we would prefer is worse than no
 * golden, because the backend team would build against it.
 *
 * **How the payload is captured.** Through the real path, not by reassembling it:
 * a real `IntemptJs` with a real `AutoTrackerModule` and a real `RequestBatcher`
 * over real (fake-indexeddb) storage, with only `fetch` and the choices engine
 * stubbed. The flush is triggered by dispatching `beforeunload` on `window`,
 * which is how the SDK itself flushes on unload — no private field is touched.
 * So what these goldens contain is the actual bytes `fetch` was called with.
 *
 * Volatile values (ids, which are random per run) are replaced with stable
 * `<token>` placeholders *by key*, so the presence, absence and nesting of every
 * field is still asserted exactly — only the entropy is normalised away.
 *
 * Run with `UPDATE_GOLDEN=1 npx vitest run tests/unit/payloadContract.test.ts`
 * to re-record after an intentional wire change. Review that diff carefully:
 * it is a customer-visible ingest contract change.
 */

const GOLDEN_DIR = join(__dirname, '__golden__', 'payload');

/** Keys whose values are random per run and are normalised to a stable token. */
const VOLATILE_KEYS = new Set([
  'eventId',
  'profileId',
  'sessionId',
  'pageId',
  'timestamp',
  'validUntil',
  // Varies per test for queue isolation (see `sourceSeq` below), not because the
  // field is uninteresting — its *presence* on the consent body is contract.
  'sourceId',
]);

function normalise(value: unknown, key?: string): unknown {
  if (key && VOLATILE_KEYS.has(key) && value !== undefined && value !== null) {
    return `<${key}>`;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // Key order is preserved as emitted — a reordering is not a contract change,
    // but recording it makes the diff smaller and more readable when one field
    // moves.
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalise(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Compares a captured payload against its golden as pretty-printed JSON.
 *
 * The comparison is on strings rather than objects deliberately: vitest's string
 * diff is line-by-line, so a human reading a CI failure sees "this one field
 * changed" rather than a collapsed object dump. Getting that failure message
 * right is most of the value of a golden test — an unreadable one gets
 * re-recorded instead of investigated.
 */
/**
 * The captured body, narrowed to the entries THIS test produced.
 *
 * Necessary for determinism, not tidiness. All tests in this file share one SDK
 * instance (see the note above — a second instance duplicates every event, which
 * is D-2 in DEFECTS.md), so an event enqueued by an earlier test can still be in
 * the queue and ride along in this test's batch. Whether it does depends purely on
 * flush timing: the goldens passed locally and on Node 22, then failed on Node 24
 * with a *different first event* in the array.
 *
 * Filtering by the names the test itself generated keeps every wire-shape
 * assertion the golden makes — field presence, absence and nesting are all still
 * exact — while removing a cross-test ordering dependency that has nothing to do
 * with the contract being asserted.
 */
function trackBodyFor(call: Call, ...names: string[]) {
  // Parses the body here rather than calling `trackBody`, which is a const
  // declared inside the describe block and so is not in scope at module level.
  const body = JSON.parse(call.init.body as string);
  const track = (body.track as any[]).filter((e: any) =>
    names.includes(e.name),
  );
  if (track.length === 0) {
    throw new Error(
      `No entry named ${names.join(' | ')} in the captured batch. ` +
        `Saw: ${(body.track as any[]).map((e: any) => e.name).join(', ') || '(empty)'}`,
    );
  }
  return { ...body, track };
}

function expectMatchesGolden(name: string, captured: unknown) {
  const file = join(GOLDEN_DIR, `${name}.json`);
  const actual = `${JSON.stringify(normalise(captured), null, 2)}\n`;

  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual, 'utf-8');
    if (process.env.UPDATE_GOLDEN !== '1') {
      throw new Error(
        `Golden file ${name}.json did not exist and has been created. ` +
          `Review it, commit it, and re-run — a golden must be reviewed by a human ` +
          `before it counts as a contract.`,
      );
    }
    return;
  }

  const expected = readFileSync(file, 'utf-8');
  if (actual !== expected) {
    // Attach the guidance to the assertion itself, so it appears in CI output
    // next to the diff rather than only in this source file.
    expect(
      actual,
      `Outbound wire payload for "${name}" changed.\n\n` +
        `This is the JSON body POSTed to ingest. If the change is intentional, ` +
        `it is an ingest contract change — confirm with the backend team, then ` +
        `re-record with UPDATE_GOLDEN=1 and explain the change in the commit ` +
        `message. If it is not intentional, a model or an id resolver has ` +
        `regressed and customer events are now shaped differently.\n`,
    ).toBe(expected);
  }
  expect(actual).toBe(expected);
}

const CONFIG = {
  organization: 'acme',
  sourceId: 'src-1',
  project: 'proj-1',
  writeKey: 'wk-user.wk-pass',
  // shopify/magento are REQUIRED on IntemptConfig, not optional. Added because
  // `tsc` rejects the literal without them while vitest happily transpiles it —
  // the unit tier does not typecheck, so a test can pass locally and still break
  // `npm run build`. The commerce trackers are off in these tests either way.
  shopify: false,
  magento: false,
};

/**
 * One shared SDK instance per file (constructed once in `beforeAll`), so the
 * auto-tracked bootstrap events (session start, page view) are drained once
 * and every other test's golden is deterministic regardless of run order.
 *
 * This used to also be load-bearing for a bug (D-2, see
 * `docs/sdk-hardening/DEFECTS.md`): `AutoTrackerModule` subscribed to
 * `document`/`window` with no teardown, so a second instance's listeners
 * stacked on top of the first's and every event — including a `consent()`
 * call — was sent once per live instance (14 duplicate consent POSTs for one
 * call, in the original repro). That is now fixed: constructing a new
 * `AutoTrackerModule` disposes whichever instance was previously active, so a
 * second instantiation is safe rather than merely avoided. See the dedicated
 * regression test at the bottom of this file.
 */
let sourceSeq = 0;

/** The choices engine issues network requests and is irrelevant to the wire format. */
vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: class {
    constructor(public config: unknown) {}
    init = async () => undefined;
  },
}));

const { IntemptJs } = await import('../../src/intemptJs/intemptJs.ts');

type Call = { url: string; init: RequestInit };

describe('outbound payload contract', () => {
  const calls: Call[] = [];
  let sdk: InstanceType<typeof IntemptJs>;
  const sourceId = `src-${++sourceSeq}`;

  // A plain function rather than `vi.fn`: the suite runs with `restoreMocks`
  // and `tests/unit/setup.ts` calls `vi.restoreAllMocks()` after every test,
  // which would strip the implementation off a `vi.fn` and leave the
  // long-lived SDK instance calling a no-op `fetch` from the second test on.
  const fetchStub = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
    };
  };

  /**
   * Requests the SDK made on its own during init, before any test ran.
   *
   * Construction auto-tracks a session start and a page view. Those land in the
   * same queue as everything else, so whichever test flushed first used to
   * capture them and its golden depended on test ordering. Draining them here
   * makes the per-method goldens deterministic *and* gives the auto-tracked
   * payloads a golden of their own — they are the majority of a real customer's
   * traffic, so leaving them unrecorded would have been the bigger gap.
   */
  let bootstrapCalls: Call[] = [];

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchStub);
    sdk = new IntemptJs({ ...CONFIG, sourceId });

    // The auto-tracked events are not dispatched synchronously by the
    // constructor — the session tracker emits on a later tick — so this waits
    // for at least one request to appear before it starts counting quiet
    // iterations. Without that, the loop concludes "nothing to drain" on the
    // first two passes and the session event leaks into whichever test flushes
    // next, which is exactly the ordering dependence it exists to remove.
    // A fixed settle first: the session, page and profile trackers each emit on
    // their own schedule, and which of them has fired by tick N is not stable
    // across runs. Waiting once for all of them is what makes the recorded set
    // of bootstrap events deterministic rather than a race.
    await new Promise((r) => setTimeout(r, 100));

    let quiet = 0;
    for (let i = 0; i < 60; i++) {
      const before = calls.length;
      window.dispatchEvent(new Event('beforeunload'));
      await new Promise((r) => setTimeout(r, 1));
      quiet = calls.length === before ? quiet + 1 : 0;
      if (calls.length > 0 && quiet >= 3) break;
    }
    bootstrapCalls = [...calls];
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    // Each test asserts only on requests it caused. The queue is drained by the
    // flush at the end of every test, so nothing carries over.
    calls.length = 0;
    vi.stubGlobal('fetch', fetchStub);
  });

  /**
   * Flushes the batcher the way the SDK does on page unload, then drains
   * microtasks until the request has actually gone out.
   *
   * `beforeunload` is used rather than reaching for the private batcher because
   * it is a real trigger with a real code path (`autoTracker.module.ts:148`), so
   * this helper also happens to assert that the unload flush works at all.
   */
  /**
   * @param names Event names this test needs in the captured batch. **Pass them
   * whenever the assertion depends on a specific event being present.** Without
   * them the poll below stops at the FIRST matching request, and that request is
   * not necessarily this test's: all tests share one SDK instance (D-2), so the
   * auto-tracked bootstrap or an earlier test's event can be flushed on its own
   * first. That is exactly how CI failed on Node 24 — "No entry named Identify in
   * the captured batch. Saw: Session start" — while Node 22 and every local run
   * passed. Waiting for the named events instead of for any request removes the
   * timing dependency rather than widening a sleep.
   */
  async function flushAndCapture(
    path: string,
    ...names: string[]
  ): Promise<Call[]> {
    // Instances from earlier tests still hold `beforeunload` listeners and will
    // also fire, so matches are narrowed to this test's own source id. The
    // consent endpoint is not source-scoped, so it is matched on path alone —
    // and each test only ever makes one consent call.
    const mine = (c: Call) =>
      c.url.includes(path) &&
      (path.includes('consents') || c.url.includes(`/sources/${sourceId}/`));

    // `enqueue()` is async (it writes through to IndexedDB), so a flush issued
    // in the same tick as the calls under test can catch only the first event
    // and split one logical batch across two requests. Letting the writes settle
    // first is what makes a multi-event golden a single deterministic request —
    // and it mirrors reality, where events are seconds apart, not microseconds.
    // 20ms, not 5, and the poll below uses real delays rather than setTimeout(0).
    // This raced on GitHub's Node 22 runner: 5ms plus twenty zero-delay ticks was
    // not enough for the IndexedDB writes to settle, so no request was ever made,
    // `flushAndCapture` returned [], and the caller crashed on `call.init` with
    // "Cannot read properties of undefined" — a message that says nothing about
    // the actual cause. Passed locally and on Node 24; only 22 was slow enough.
    await new Promise((r) => setTimeout(r, 20));

    /** Have the wanted events actually landed in one of my requests yet? */
    const satisfied = () => {
      const matched = calls.filter(mine);
      if (matched.length === 0) return false;
      if (names.length === 0) return true;
      return names.every((name) =>
        matched.some((c) => {
          const body = JSON.parse(c.init.body as string);
          return (body.track as { name: string }[] | undefined)?.some(
            (e) => e.name === name,
          );
        }),
      );
    };

    for (let i = 0; i < 60; i++) {
      window.dispatchEvent(new Event('beforeunload'));
      await new Promise((r) => setTimeout(r, 2));
      if (satisfied()) break;
    }

    const matched = calls.filter(mine);
    if (matched.length === 0) {
      // Fail with the real reason rather than letting the caller dereference
      // undefined. If this ever fires, the flush genuinely did not happen — do
      // not "fix" it by raising the timeout again without checking why.
      throw new Error(
        `flushAndCapture('${path}') captured no request for source ${sourceId}. ` +
          `Seen: ${calls.map((c) => c.url).join(', ') || '(none)'}`,
      );
    }
    // Requests carrying a wanted event first, so `const [call] = ...` picks a
    // useful one even if a bootstrap-only batch went out ahead of it.
    if (names.length > 0) {
      const carries = (c: Call) => {
        const body = JSON.parse(c.init.body as string);
        return (body.track as { name: string }[] | undefined)?.some((e) =>
          names.includes(e.name),
        )
          ? 0
          : 1;
      };
      matched.sort((a, b) => carries(a) - carries(b));
    }
    return matched;
  }

  const trackBody = (call: Call) => JSON.parse(call.init.body as string);

  describe('the /track endpoint', () => {
    it('posts to the source-scoped track URL with basic auth from the write key', async () => {
      // The URL shape and the credential encoding are as much of the contract as
      // the body. `BACKEND.md` item 1 is about removing this header — that work
      // needs the current form recorded before it can be changed.
      sdk.track({ eventTitle: 'Signup Clicked', data: { plan: 'pro' } } as any);
      const [call] = await flushAndCapture('/track');

      expect(call).toBeDefined();
      // The API base comes from `EnvConfig.getApi()` and is empty under test, so
      // the assertion pins the path — which is the part the SDK builds — rather
      // than the host, which is environment config.
      expect(call!.url).toBe(
        `/acme/projects/proj-1/sources/${sourceId}/track?ip=1`,
      );
      expect(call!.init.method).toBe('POST');
      expect(
        (call!.init.headers as Record<string, string>)['Content-Type'],
      ).toBe('application/json');
      expect(
        (call!.init.headers as Record<string, string>)['Authorization'],
      ).toBe(`Basic ${btoa('wk-user:wk-pass')}`);
      // keepalive is what lets an unload flush survive navigation. Losing it
      // means losing the last batch of every session.
      expect(call!.init.keepalive).toBe(true);
    });

    it('wraps every batch in a top-level {track:[...]} envelope', async () => {
      // The envelope key is the single most load-bearing byte in the format: a
      // rename makes ingest see an empty request and drop the whole batch with a
      // 200, which is silent total loss.
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      const [call] = await flushAndCapture('/track');
      const body = trackBody(call!);

      expect(Object.keys(body)).toEqual(['track']);
      expect(Array.isArray(body.track)).toBe(true);
    });

    it('records the track payload', async () => {
      sdk.track({
        eventTitle: 'Signup Clicked',
        data: { plan: 'pro', seats: 3 },
      } as any);
      const [call] = await flushAndCapture('/track', 'Signup Clicked');
      expectMatchesGolden('track', trackBodyFor(call!, 'Signup Clicked'));
    });

    it('records the identify payload, with and without optional fields', async () => {
      sdk.identify({
        eventTitle: 'Signed Up',
        userId: 'user-9',
        userAttributes: { email: 'a@b.c', plan: 'pro' },
        data: { source: 'form' },
      } as any);
      const [call] = await flushAndCapture('/track', 'Signed Up');
      expectMatchesGolden('identify-full', trackBodyFor(call!, 'Signed Up'));
    });

    it('records the minimal identify payload — showing which keys vanish', async () => {
      // This golden is the one that answers "is the field optional or absent?".
      // `JSON.stringify` drops `undefined`, so `userAttributes: undefined` in the
      // model becomes *no key at all* on the wire. Ingest therefore cannot
      // distinguish "not provided" from "never supported", which is exactly the
      // ambiguity that made $lib_version risky to add.
      sdk.identify({ userId: 'user-9' } as any);
      const [call] = await flushAndCapture('/track', 'Identify');
      expectMatchesGolden('identify-minimal', trackBodyFor(call!, 'Identify'));
    });

    it('records the group payload', async () => {
      sdk.group({
        eventTitle: 'Joined Org',
        accountId: 'acct-3',
        accountAttributes: { tier: 'gold' },
      } as any);
      const [call] = await flushAndCapture('/track', 'Joined Org');
      expectMatchesGolden('group', trackBodyFor(call!, 'Joined Org'));
    });

    it('records the alias payload — the one model with no session or page', async () => {
      sdk.alias({ userId: 'u-new', anotherUserId: 'u-old' } as any);
      const [call] = await flushAndCapture('/track', 'Identify');
      expectMatchesGolden('alias', trackBody(call!));
    });

    it('records the record payload', async () => {
      sdk.record({
        eventTitle: 'Order Completed',
        userId: 'u1',
        accountId: 'a1',
        data: { total: 42 },
        userAttributes: { email: 'a@b.c' },
        accountAttributes: { tier: 'gold' },
      } as any);
      const [call] = await flushAndCapture('/track', 'Order Completed');
      expectMatchesGolden('record', trackBodyFor(call!, 'Order Completed'));
    });

    it('records the product payloads, including a multi-line order', async () => {
      sdk.productOrdered([
        { productId: 'p1', price: 10 },
        { productId: 'p2', price: 20 },
      ] as any);
      const [call] = await flushAndCapture('/track', 'Product ordered');
      expectMatchesGolden(
        'product-ordered',
        trackBodyFor(call!, 'Product ordered'),
      );
    });

    it('records a mixed batch — several event types in one request', async () => {
      // Batching is the normal case, not the exception, and the batch is
      // heterogeneous. If ingest ever validated per-request on a single event
      // type this is the payload that would break, so it is worth pinning
      // separately from the single-event goldens.
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      sdk.identify({ userId: 'user-9' } as any);
      sdk.productView('p-42');
      // All three names: this golden asserts a *multi-event* batch, so a request
      // carrying only the first event would satisfy a bare wait and then fail the
      // length assertion below.
      const [call] = await flushAndCapture(
        '/track',
        'A',
        'Identify',
        'Product viewed',
      );
      const body = trackBody(call!);
      expect(body.track.length).toBeGreaterThanOrEqual(3);
      expectMatchesGolden('mixed-batch', body);
    });

    it('emits NO timestamp on any event — a defect, recorded not fixed', async () => {
      // DEFECT, and the most consequential thing in this file. Every model has
      // its `timestamp: new Date().getTime()` line **commented out**
      // (track.model.ts:16, identify.model.ts:17, group.model.ts:16,
      // alias.model.ts:16, record.model.ts:16, product.model.ts:17,
      // session.model.ts:15, consent.model.ts:25). So no event carries a
      // client-side timestamp and ingest can only use its own receive time.
      //
      // That matters more than it looks: events sit in the queue across a
      // circuit-breaker window (60s, CHECKPOINT §3b), across backoff, and across
      // page reloads via persisted storage. An event generated before a reload
      // and delivered minutes later is attributed to the delivery moment. Event
      // ordering within a session is therefore not recoverable from the payload.
      //
      // Recorded rather than fixed: adding `timestamp` is precisely the kind of
      // new field CHECKPOINT §2 forbids shipping blind, and it belongs with
      // `BACKEND.md` item 4 as one conversation with ingest.
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      const [call] = await flushAndCapture('/track');
      const body = trackBody(call!);
      for (const event of body.track) {
        for (const entry of event.payload ?? []) {
          expect(entry).not.toHaveProperty('timestamp');
        }
      }
    });

    it('emits no $lib_version, which is what BACKEND.md item 4 would add', async () => {
      // Pinned so that when $lib_version lands, this test fails and forces the
      // goldens to be re-recorded in the same commit. That is the mechanism this
      // whole file exists to provide: the field cannot be added silently.
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      const [call] = await flushAndCapture('/track');
      const body = trackBody(call!);
      expect(JSON.stringify(body)).not.toContain('lib_version');
      expect(body.track[0]).not.toHaveProperty('$lib_version');
    });

    it('sends the event name at the envelope level, not per payload entry', async () => {
      // `name` is a sibling of `payload`, so a batch of N payload entries shares
      // one name. That is why `productOrdered` of three lines is one event with
      // three entries rather than three events — a structural fact ingest has to
      // know to count events correctly.
      sdk.productOrdered([{ productId: 'p1' }, { productId: 'p2' }] as any);
      const [call] = await flushAndCapture('/track', 'Product ordered');
      const event = trackBody(call!).track.find(
        (e: any) => e.name === 'Product ordered',
      );
      expect(event).toBeDefined();
      expect(event.payload).toHaveLength(2);
      expect(event.payload[0]).not.toHaveProperty('name');
    });

    it('records the auto-tracked bootstrap payloads — session start and page view', () => {
      // These are what the SDK sends with no customer code involved at all, and
      // for most sources they outnumber manual events. `BACKEND.md` item 4 wants
      // `$lib_version` on `SessionEventModel` specifically (CHECKPOINT §2 task 2
      // names that file), so this golden is the one that change lands against.
      expect(bootstrapCalls.length).toBeGreaterThan(0);
      const bodies = bootstrapCalls
        .filter((c) => c.url.includes('/track'))
        .map((c) => JSON.parse(c.init.body as string));
      expectMatchesGolden('bootstrap-autotracked', bodies);
    });

    it('auto-tracked events carry NO type field, unlike every manual event — recorded', () => {
      // DEFECT / asymmetry worth stating to ingest. `TrackModel`, `IdentifyModel`,
      // `GroupModel`, `AliasModel`, `RecordModel`, `ProductModel` and
      // `ConsentModel` all declare `readonly type`. `SessionEventModel`,
      // `PageEventModel` and `HtmlEventModel` do not. So ingest cannot switch on
      // `type` to classify an event — it is present on manual events and absent
      // on automatic ones. The SDK itself relies on this: the auto-tracker's
      // event pool routes on `type === 'consent'` and everything without a type
      // falls through the `default` branch, which is why the gap has never
      // surfaced client-side.
      const bodies = bootstrapCalls
        .filter((c) => c.url.includes('/track'))
        .flatMap((c) => JSON.parse(c.init.body as string).track as any[]);
      expect(bodies.length).toBeGreaterThan(0);
      for (const event of bodies) {
        expect(event).not.toHaveProperty('type');
      }
    });

    it('the session event reuses the sessionId as its eventId — recorded, not fixed', () => {
      // DEFECT (session.model.ts:14): `eventId: sessionId`. Every session event
      // for a given visit therefore shares one eventId, and it collides with the
      // session identifier itself. The batcher dedupes on eventId
      // (CHECKPOINT §4 defect 1), so a second session event in the same visit —
      // session end after session start, say — can be discarded as a duplicate
      // of the first. Recorded rather than fixed because changing it alters ids
      // ingest may already be joining on.
      const events = bootstrapCalls
        .filter((c) => c.url.includes('/track'))
        .flatMap((c) => JSON.parse(c.init.body as string).track as any[])
        .filter(
          (e) =>
            typeof e.name === 'string' &&
            e.name.toLowerCase().includes('session'),
        );

      for (const event of events) {
        for (const entry of event.payload) {
          expect(entry.eventId).toBe(entry.sessionId);
        }
      }
    });
  });

  describe('the /consents/data endpoint', () => {
    it('posts consent to a different endpoint with a flat, unenveloped body', async () => {
      // Consent is routed by `type === 'consent'` in the auto-tracker's event
      // pool and never enters the batcher, so it has neither the `{track:[]}`
      // envelope nor any batching or retry. A consent record lost to a network
      // blip is lost permanently — worth recording as a property of the format.
      sdk.consent({
        action: 'accept',
        validUntil: 1893456000000,
        email: 'a@b.c',
        message: 'Accepted terms',
        category: 'marketing',
      } as any);

      const consentCalls = await flushAndCapture('/consents/data');
      expect(consentCalls).toHaveLength(1);
      const call = consentCalls[0]!;
      expect(call.url).toBe('/acme/projects/proj-1/consents/data');
      expect(
        (call.init.headers as Record<string, string>)['Authorization'],
      ).toBe(`Basic ${btoa('wk-user:wk-pass')}`);

      const body = JSON.parse(call.init.body as string);
      expect(body).not.toHaveProperty('track');
      expectMatchesGolden('consent', body);
    });

    /**
     * D-2 regression test. Must run last in this file: constructing a second
     * `IntemptJs` disposes whichever instance is currently active (see
     * `autoTracker.module.ts`'s `activeInstance` guard), so `sdk` — the
     * instance shared by every earlier test in this file via `beforeAll` — is
     * retired the moment this test runs, and no later test may depend on it.
     *
     * Before the fix, a second instance's `document` listeners stacked on top
     * of the first instance's instead of replacing them, so a single
     * `consent()` call produced one POST per live instance (14 duplicates in
     * the original repro). This asserts exactly one.
     */
    it('a second instance does not duplicate a consent call from an earlier instance (D-2)', async () => {
      const secondSourceId = `src-${++sourceSeq}`;
      const sdk2 = new IntemptJs({ ...CONFIG, sourceId: secondSourceId });

      sdk2.consent({
        action: 'accept',
        validUntil: 1893456000000,
        email: 'a@b.c',
        message: 'Accepted terms',
        category: 'marketing',
      } as any);

      const consentCalls = await flushAndCapture('/consents/data');
      expect(consentCalls).toHaveLength(1);
    });
  });
});
