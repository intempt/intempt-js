import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public API class — `src/intemptJs/intemptJs.ts`.
 *
 * **Why this file exists.** This is the only class a customer ever calls, and it
 * had no test in either tier. The 80 tests in `intemptJsGuard.test.ts` cover the
 * *argument validation* every method calls first; nothing covered the methods
 * themselves. So the thing that was untested is exactly the part that decides
 * what a customer's event looks like: which ids get attached, which model is
 * built, and which DOM event carries it to the transport.
 *
 * **What "behaviour" means here, and why it is asserted this way.** `IntemptJs`
 * does not send anything. Every method builds a model and hands it off by
 * dispatching a `CustomEvent` on `document`; `AutoTrackerModule` listens for
 * `intempt:event` and enqueues it. That DOM hand-off *is* the observable
 * contract between the public API and the transport — so these tests listen on
 * `document` exactly as the real subscriber does, rather than reaching into
 * private fields. If an assertion here is wrong, the symptom in production is an
 * event that is silently never enqueued, or one enqueued with a missing id.
 *
 * The two collaborators are mocked because they are separately tested and
 * because constructing the real ones starts timers, opens IndexedDB and issues
 * network requests — none of which this unit's behaviour depends on.
 */

const autoTrackerInstances: MockAutoTracker[] = [];

class MockAutoTracker {
  doNotTrack = false;
  init = vi.fn();
  refresh = vi.fn();
  getProfileId = vi.fn(() => 'profile-1');
  getSessionId = vi.fn(() => 'session-1');
  getPageId = vi.fn(() => 'page-1');
  constructor(
    public config: unknown,
    public api: string,
  ) {
    autoTrackerInstances.push(this);
  }
}

const choicesInstances: MockChoices[] = [];

class MockChoices {
  init = vi.fn(async () => undefined);
  constructor(public config: Record<string, unknown>) {
    choicesInstances.push(this);
  }
}

vi.mock('../../src/intemptJs/modules/autoTracker/autoTracker.module.ts', () => ({
  AutoTrackerModule: MockAutoTracker,
}));

vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: MockChoices,
}));

const { IntemptJs } = await import('../../src/intemptJs/intemptJs.ts');
const { SDK_VERSION } = await import('../../src/shared/version.ts');

const CONFIG = {
  organization: 'acme',
  sourceId: 'src-1',
  project: 'proj-1',
  writeKey: 'user.pass',
  // shopify/magento are REQUIRED on IntemptConfig, not optional. Added because
  // `tsc` rejects the literal without them while vitest happily transpiles it —
  // the unit tier does not typecheck, so a test can pass locally and still break
  // `npm run build`. The commerce trackers are off in these tests either way.
  shopify: false,
  magento: false,
};

/** Captures every `intempt:*` CustomEvent the SDK dispatches during a test. */
function captureDispatches(names: string[]) {
  const seen: Array<{ name: string; detail: any }> = [];
  const listeners = names.map((name) => {
    const listener = (ev: Event) => seen.push({ name, detail: (ev as CustomEvent).detail });
    document.addEventListener(name, listener);
    return { name, listener };
  });
  return {
    seen,
    stop: () => listeners.forEach(({ name, listener }) => document.removeEventListener(name, listener)),
  };
}

const ALL_EVENT_NAMES = [
  'intempt:event',
  'intempt:track',
  'intempt:identify',
  'intempt:group',
  'intempt:record',
  'intempt:alias',
  'intempt:consent',
  'intempt:product',
  'intempt:logOut',
];

describe('IntemptJs — the public API class', () => {
  let sdk: InstanceType<typeof IntemptJs>;
  let capture: ReturnType<typeof captureDispatches>;

  beforeEach(() => {
    autoTrackerInstances.length = 0;
    choicesInstances.length = 0;
    capture = captureDispatches(ALL_EVENT_NAMES);
    sdk = new IntemptJs({ ...CONFIG });
  });

  afterEach(() => {
    capture.stop();
  });

  const tracker = () => autoTrackerInstances[0]!;
  const dispatched = (name: string) => capture.seen.filter((e) => e.name === name);
  /** The model handed to the transport by the most recent `intempt:event`. */
  const lastModel = () => dispatched('intempt:event').at(-1)!.detail.event;

  describe('construction', () => {
    it('builds the auto-tracker and starts it before anything else can be tracked', () => {
      // `init()` wires the page and HTML trackers. If the constructor ever stops
      // calling it, automatic page/click tracking silently disappears while
      // manual `track()` calls keep working — a partial failure that looks fine
      // in a smoke test.
      expect(autoTrackerInstances).toHaveLength(1);
      expect(tracker().init).toHaveBeenCalledTimes(1);
    });

    it('passes a copy of the config, not the caller’s object', () => {
      // The config is spread into `_config`. A customer mutating the object they
      // passed (a framework re-using a settings object, say) must not be able to
      // repoint the SDK's credentials or source id after init.
      const original = { ...CONFIG };
      const instance = new IntemptJs(original);
      (original as any).sourceId = 'mutated';
      expect(autoTrackerInstances.at(-1)!.config).toMatchObject({ sourceId: 'src-1' });
      expect(instance).toBeDefined();
    });

    it('seeds the choices engine with the resolved profile and session ids', () => {
      // The choices engine personalises with these ids. If they were read before
      // the auto-tracker resolved them, every visitor would request experiences
      // as an anonymous/blank profile and personalisation would silently degrade
      // to control for everyone.
      expect(choicesInstances).toHaveLength(1);
      expect(choicesInstances[0]!.config).toMatchObject({
        profileId: 'profile-1',
        sessionId: 'session-1',
        sourceId: 'src-1',
      });
      expect(choicesInstances[0]!.init).toHaveBeenCalledTimes(1);
    });

    it('throws out of the constructor on an empty config field, so no half-built instance escapes', () => {
      expect(() => new IntemptJs({ ...CONFIG, writeKey: '' })).toThrow(
        'IntemptJs initialization failed: All config fields must be provided.',
      );
      // Nothing was constructed, which is the safe outcome: no tracker, no
      // listeners, no queue.
      expect(autoTrackerInstances).toHaveLength(1); // only the beforeEach instance
    });
  });

  describe('VERSION', () => {
    it('is exposed both statically and on the instance', () => {
      // `window.intempt.VERSION` is how support asks a customer which build they
      // are on, and the static is how a bundler consumer reads it. Both are
      // public contract; dropping either is a breaking change.
      expect(IntemptJs.VERSION).toBe(SDK_VERSION);
      expect(sdk.VERSION).toBe(SDK_VERSION);
    });
  });

  describe('opt-in / opt-out', () => {
    it('optOut sets doNotTrack on the tracker, which is where it gets persisted', () => {
      sdk.optOut();
      expect(tracker().doNotTrack).toBe(true);
      expect(sdk.isUserOptIn()).toBe(false);
    });

    it('optIn clears it, so consent is not a one-way door', () => {
      sdk.optOut();
      sdk.optIn();
      expect(tracker().doNotTrack).toBe(false);
      expect(sdk.isUserOptIn()).toBe(true);
    });

    it.each([
      ['track', () => sdk.track({ eventTitle: 'Clicked', data: { a: 1 } } as any)],
      ['identify', () => sdk.identify({ userId: 'u1' } as any)],
      ['group', () => sdk.group({ accountId: 'a1' } as any)],
      ['record', () => sdk.record({ eventTitle: 'Rec', userId: 'u1' } as any)],
      ['alias', () => sdk.alias({ userId: 'u1', anotherUserId: 'u2' } as any)],
      ['productAdd', () => sdk.productAdd({ productId: 'p1' } as any)],
      ['productOrdered', () => sdk.productOrdered([{ productId: 'p1' } as any])],
      ['productView', () => sdk.productView('p1')],
      ['logOut', () => sdk.logOut()],
    ])('%s emits nothing once the user has opted out', (_name, call) => {
      // This is the load-bearing privacy assertion for the whole class: an
      // opted-out visitor must produce no outbound event from any entry point.
      // A method added later without the `isUserOptIn()` guard would leak, and
      // the leak would be invisible — the event just gets queued and sent.
      sdk.optOut();
      const before = capture.seen.length;
      call();
      expect(capture.seen.slice(before)).toHaveLength(0);
    });
  });

  describe('track', () => {
    it('builds a track model carrying all three ids and the caller’s data', () => {
      // The three ids are what join an event to a visitor, a visit and a page
      // view. A missing one does not fail the request — ingest accepts it and
      // the event is simply unattributable afterwards, so it has to be asserted
      // here rather than caught downstream.
      sdk.track({ eventTitle: 'Signup Clicked', data: { plan: 'pro' } } as any);

      const model = lastModel();
      expect(model.type).toBe('track');
      expect(model.name).toBe('Signup Clicked');
      expect(model.payload).toHaveLength(1);
      expect(model.payload[0]).toMatchObject({
        profileId: 'profile-1',
        sessionId: 'session-1',
        pageId: 'page-1',
        data: { plan: 'pro' },
      });
      expect(model.payload[0].eventId).toMatch(/^ev/);
    });

    it('announces the event name on intempt:track before handing the model over', () => {
      // `intempt:track` is the hook customers bind their own analytics to. The
      // ordering matters: the name notification is documented as firing for a
      // call that will actually be sent.
      sdk.track({ eventTitle: 'Signup Clicked', data: { plan: 'pro' } } as any);
      expect(dispatchedNames()).toEqual(['intempt:track', 'intempt:event']);
      expect(dispatched('intempt:track')[0]!.detail).toEqual({ eventName: 'Signup Clicked' });
    });

    it('re-reads the ids on every call rather than caching them at construction', () => {
      // Sessions roll over and pages change. If the ids were captured once in the
      // constructor, every event on a long-lived SPA tab would be stamped with
      // the first page's id and session attribution would drift silently.
      sdk.track({ eventTitle: 'First', data: { n: 1 } } as any);
      tracker().getPageId.mockReturnValue('page-2');
      tracker().getSessionId.mockReturnValue('session-2');
      sdk.track({ eventTitle: 'Second', data: { n: 2 } } as any);

      expect(lastModel().payload[0]).toMatchObject({
        pageId: 'page-2',
        sessionId: 'session-2',
      });
    });

    it('mints a distinct eventId per call, so a retry cannot be mistaken for a second event', () => {
      // The batcher dedupes on eventId. Colliding ids would make two genuine
      // events collapse into one — silent under-counting.
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      sdk.track({ eventTitle: 'A', data: { n: 1 } } as any);
      const ids = dispatched('intempt:event').map((e) => e.detail.event.payload[0].eventId);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('identify', () => {
    it('carries the userId and the optional attributes', () => {
      // `eventTitle` is required by the guard whenever `userAttributes` is used
      // (`isIdentifyValid`), so the maximal call necessarily names itself.
      sdk.identify({
        eventTitle: 'Signed Up',
        userId: 'user-9',
        userAttributes: { email: 'a@b.c' },
        data: { source: 'form' },
      } as any);

      const model = lastModel();
      expect(model.type).toBe('identify');
      expect(model.payload[0]).toMatchObject({
        userId: 'user-9',
        userAttributes: { email: 'a@b.c' },
        data: { source: 'form' },
        profileId: 'profile-1',
        sessionId: 'session-1',
        pageId: 'page-1',
      });
    });

    it('defaults the event name to "Identify" when no eventTitle is given', () => {
      // Ingest routes on this name. An undefined name would land as an unnamed
      // event rather than an identify.
      sdk.identify({ userId: 'user-9' } as any);
      expect(lastModel().name).toBe('Identify');
      expect(dispatched('intempt:identify')[0]!.detail).toEqual({ eventName: 'Identify' });
    });

    it('honours a caller-supplied eventTitle', () => {
      sdk.identify({ userId: 'user-9', eventTitle: 'Logged In' } as any);
      expect(lastModel().name).toBe('Logged In');
    });
  });

  describe('group', () => {
    it('carries the accountId and account attributes', () => {
      // As with identify, the guard requires `eventTitle` alongside attributes.
      sdk.group({
        eventTitle: 'Joined Org',
        accountId: 'acct-3',
        accountAttributes: { tier: 'gold' },
      } as any);
      const model = lastModel();
      expect(model.type).toBe('group');
      expect(model.payload[0]).toMatchObject({
        accountId: 'acct-3',
        accountAttributes: { tier: 'gold' },
        profileId: 'profile-1',
      });
    });

    it('defaults its event name to "Identify" — a defect, asserted not fixed', () => {
      // DEFECT (group.model.ts:12): `GroupModel` falls back to `'Identify'`, the
      // same default `IdentifyModel` uses, so a `group()` call with no
      // eventTitle arrives at ingest named "Identify" and is indistinguishable
      // from an identify event in reporting. It should default to something like
      // 'Group'. Not fixed here: the name is on the wire today, so changing it
      // silently re-buckets existing customers' historical event streams — that
      // is a coordinated change with ingest, not a test-suite fix.
      sdk.group({ accountId: 'acct-3' } as any);
      expect(lastModel().name).toBe('Identify');
    });
  });

  describe('alias', () => {
    it('carries both user ids and deliberately omits session and page', () => {
      // Aliasing merges two identities; it is not a page-scoped act, so the
      // model has no sessionId/pageId. Asserted so a well-meaning "consistency"
      // refactor that adds them has to justify the wire change.
      sdk.alias({ userId: 'u-new', anotherUserId: 'u-old' } as any);
      const model = lastModel();
      expect(model.type).toBe('alias');
      expect(model.payload[0]).toMatchObject({
        userId: 'u-new',
        anotherUserId: 'u-old',
        profileId: 'profile-1',
      });
      expect(model.payload[0]).not.toHaveProperty('sessionId');
      expect(model.payload[0]).not.toHaveProperty('pageId');
    });

    it('is always named "Identify"', () => {
      sdk.alias({ userId: 'u-new', anotherUserId: 'u-old' } as any);
      expect(lastModel().name).toBe('Identify');
      expect(dispatched('intempt:alias')[0]!.detail).toEqual({ eventName: 'Identify' });
    });
  });

  describe('record', () => {
    it('carries every optional field the caller supplied', () => {
      sdk.record({
        eventTitle: 'Order',
        userId: 'u1',
        accountId: 'a1',
        data: { total: 10 },
        userAttributes: { email: 'a@b.c' },
        accountAttributes: { tier: 'gold' },
      } as any);

      const model = lastModel();
      expect(model.type).toBe('record');
      expect(model.name).toBe('Order');
      expect(model.payload[0]).toMatchObject({
        userId: 'u1',
        accountId: 'a1',
        data: { total: 10 },
        userAttributes: { email: 'a@b.c' },
        accountAttributes: { tier: 'gold' },
        profileId: 'profile-1',
      });
    });

    it('announces its real eventName on intempt:record — D-13 fixed', () => {
      // FIX (D-13, record.model.ts): `RecordModel._name` returned a hardcoded
      // `''` instead of `this.name`, so the `intempt:record` notification always
      // carried `{ eventName: '' }` even though the model's `name` was correct
      // and the wire payload was fine. Any customer listener switching on
      // `eventName` saw nothing. `ProductModel._name` had the identical bug
      // (product.model.ts), fixed with it and asserted below.
      //
      // `_name` is read ONLY for these notification events — never for the
      // outbound payload — so this changes the CustomEvent detail and nothing
      // that reaches ingest. It is still customer-visible: a listener that
      // worked around the empty string now sees a real name. Release-noted.
      sdk.record({ eventTitle: 'Order', userId: 'u1' } as any);
      expect(dispatched('intempt:record')[0]!.detail).toEqual({ eventName: 'Order' });
      // `_name` now agrees with the model's own name, which was always correct.
      expect(lastModel().name).toBe('Order');
    });
  });

  describe('consent', () => {
    it('is a flat model — no payload array, and it carries sourceId from config', () => {
      // Consent goes to a *different* endpoint (`/consents/data`) with the model
      // spread at the top level, not wrapped in `{track:[...]}`. That routing is
      // driven entirely by `type === 'consent'` in the auto-tracker's event pool,
      // so the type and the flat shape are both load-bearing.
      sdk.consent({
        action: 'accept',
        validUntil: 1893456000000,
        email: 'a@b.c',
        message: 'Accepted terms',
        category: 'marketing',
      } as any);

      const model = lastModel();
      expect(model.type).toBe('consent');
      expect(model).toMatchObject({
        action: 'accept',
        validUntil: 1893456000000,
        email: 'a@b.c',
        message: 'Accepted terms',
        category: 'marketing',
        sourceId: 'src-1',
        profileId: 'profile-1',
        source: 'web',
      });
      expect(model).not.toHaveProperty('payload');
    });

    it('announces "consent" as its event name', () => {
      sdk.consent({ action: 'reject', validUntil: 1 } as any);
      expect(dispatched('intempt:consent')[0]!.detail).toEqual({ eventName: 'consent' });
    });

    it('is NOT gated on opt-out, fixed (D-5): a refusal is still recorded', () => {
      // FIX (D-5): consent() used to share the `isUserOptIn()` guard with every
      // tracking method, so `optOut()` followed by `consent({action:'reject'})`
      // silently discarded the very record of the refusal — a GDPR audit-trail
      // hazard, and USAGE.md had to document a required call order to work
      // around it. Recording a consent decision is an audit act, not tracking,
      // so it must always succeed regardless of opt-out state.
      sdk.optOut();
      sdk.consent({ action: 'reject', validUntil: 1 } as any);
      expect(lastModel()).toMatchObject({ type: 'consent', action: 'reject' });
      expect(dispatched('intempt:consent')).toHaveLength(1);
    });

    it('does not read a pageId it cannot carry — D-16 fixed', () => {
      // FIX (D-16): `consent()` read `getPageId()` and passed it into
      // `ConsentModel`, which declares no `pageId` field, so it was discarded.
      // The read was not free — `PageTrackerModule.getId()` mints the
      // page-session cookie when none exists, and `consent()` is deliberately
      // ungated by opt-out (D-5), so rejecting consent while opted out wrote a
      // tracking cookie. The call is gone; the model shape is unchanged.
      sdk.consent({ action: 'accept', validUntil: 1 } as any);
      expect(lastModel()).not.toHaveProperty('pageId');
      expect(tracker().getPageId).not.toHaveBeenCalled();
      // Still a complete consent record — dropping the dead read cost nothing.
      expect(lastModel()).toMatchObject({ type: 'consent', action: 'accept', profileId: 'profile-1' });
    });
  });

  describe('product helpers', () => {
    it('productAdd wraps the single product in a one-element payload', () => {
      sdk.productAdd({ productId: 'p1', price: 9.99 } as any);
      const model = lastModel();
      expect(model.type).toBe('product');
      expect(model.name).toBe('Added to cart');
      expect(model.payload).toHaveLength(1);
      expect(model.payload[0].data).toEqual({ productId: 'p1', price: 9.99 });
    });

    it('productOrdered emits one payload entry per product, each with its own eventId', () => {
      // An order of N lines must arrive as N attributable events. Collapsing them
      // into one, or reusing an eventId across them, silently loses revenue rows
      // to the batcher's dedupe.
      sdk.productOrdered([{ productId: 'p1' }, { productId: 'p2' }, { productId: 'p3' }] as any);
      const model = lastModel();
      expect(model.name).toBe('Product ordered');
      expect(model.payload).toHaveLength(3);
      expect(new Set(model.payload.map((p: any) => p.eventId)).size).toBe(3);
      expect(model.payload.map((p: any) => p.data.productId)).toEqual(['p1', 'p2', 'p3']);
    });

    it('productOrdered with an empty array still emits an event with no payload', () => {
      // Asserted because it is the shape ingest receives for a degenerate call:
      // an event named "Product Order" carrying nothing. Worth knowing it is not
      // rejected client-side.
      sdk.productOrdered([]);
      expect(lastModel().payload).toEqual([]);
    });

    it('productView carries only the productId', () => {
      sdk.productView('p-42');
      expect(lastModel().payload[0].data).toEqual({ productId: 'p-42' });
      expect(lastModel().name).toBe('Product viewed');
    });

    it('the product helpers bypass argument validation entirely — asserted, not fixed', () => {
      // DEFECT (intemptJs.ts:229/250/272): unlike `track`/`identify`/etc, the
      // three product methods call no guard at all. `productAdd(undefined)`
      // therefore builds and dispatches an event with `data: undefined` rather
      // than throwing a clear error at the call site. Not fixed here because
      // adding a throw is a breaking change for any customer currently calling
      // them loosely; it needs a deprecation note.
      expect(() => sdk.productAdd(undefined as any)).not.toThrow();
      expect(lastModel().payload[0].data).toBeUndefined();
    });

    it('all three product helpers announce their real eventName — D-13 fixed', () => {
      // Same root cause as the `record` fix above: `ProductModel._name` returned
      // `''`. Each helper sets its own title, so assert all three rather than one
      // — a single case would not catch a helper whose title never reached the
      // model.
      sdk.productAdd({ productId: 'p1' } as any);
      expect(dispatched('intempt:product').at(-1)!.detail).toEqual({ eventName: 'Added to cart' });

      sdk.productView('p-42');
      expect(dispatched('intempt:product').at(-1)!.detail).toEqual({ eventName: 'Product viewed' });

      sdk.productOrdered([{ productId: 'p1' }] as any);
      expect(dispatched('intempt:product').at(-1)!.detail).toEqual({ eventName: 'Product ordered' });
    });
  });

  describe('logOut', () => {
    it('refreshes the profile, session and page ids so the next visitor is a new one', () => {
      // Without the refresh, a shared device keeps the previous user's profileId
      // and their events merge — a privacy incident, not just bad data.
      sdk.logOut();
      expect(tracker().refresh).toHaveBeenCalledTimes(1);
      expect(dispatched('intempt:logOut')[0]!.detail).toEqual({ eventName: 'Log Out' });
    });

    it('does not emit an intempt:event, so nothing is queued for it', () => {
      // `logOut` is a local state reset plus a notification; it deliberately has
      // no wire payload.
      const before = dispatched('intempt:event').length;
      sdk.logOut();
      expect(dispatched('intempt:event')).toHaveLength(before);
    });
  });

  describe('recommendation', () => {
    const okResponse = (body: unknown) => ({ json: async () => body });

    it('posts to the feed endpoint with basic auth built from the write key', async () => {
      const fetchSpy = vi.fn(async () => okResponse({ items: [1] }));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await sdk.recommendation({ id: 'feed-7', quantity: 5, fields: ['a'] } as any);

      expect(result).toEqual({ items: [1] });
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain('/acme/projects/proj-1/feeds/feed-7/data');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Basic ${btoa('user:pass')}`,
      );
      expect(JSON.parse(init.body as string)).toMatchObject({
        profileId: 'profile-1',
        sourceId: 'src-1',
        limit: 5,
        fields: ['a'],
      });
    });

    it('returns null instead of throwing when the network fails', async () => {
      // This is called from customer render code. A rejected promise there is an
      // unhandled rejection in *their* app, so the swallow is deliberate — but
      // it must be asserted, because it is also the reason a broken feed looks
      // like an empty feed.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('offline');
        }),
      );
      await expect(
        sdk.recommendation({ id: 'feed-7', quantity: 5, fields: [] } as any),
      ).resolves.toBeNull();
    });

    it('is gated on opt-out, fixed (D-4): no identifier leaves the page', async () => {
      // FIX (D-4): `recommendation()` used to be the one public method with no
      // `isUserOptIn()` check, so an opted-out visitor still had their
      // `profileId` posted to the feed endpoint. It now returns `null` and
      // never calls `fetch`, matching every other entry point.
      const fetchSpy = vi.fn(async () => okResponse({}));
      vi.stubGlobal('fetch', fetchSpy);
      sdk.optOut();
      const result = await sdk.recommendation({ id: 'feed-7', quantity: 1, fields: [] } as any);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('the constructor’s invalid-config bail is unreachable — CHECKPOINT §4 correction', () => {
    it('isValidConfig can only return true or throw, so the `return` branch is dead code', () => {
      // CHECKPOINT §4 records this as "newly observed, not fixed": that
      // `optIn()`/`optOut()` dereference `this._autoTracker`, which is "left
      // `undefined` when the constructor bails on an invalid config
      // (intemptJs.ts:36)".
      //
      // The premise is wrong, and this test records the correction so nobody
      // ships a one-line guard for a path that cannot be reached.
      // `IntemptJsGuard.isValidConfig` (guard line 24) either **throws** or
      // returns a literal `true` — it never returns false. So
      // `if (!this.isValidConfig(config)) return;` never executes its `return`,
      // and a misconfigured `new IntemptJs(...)` throws rather than yielding a
      // half-built instance. There is no reachable state in which a customer
      // holds an `IntemptJs` whose `_autoTracker` is undefined.
      //
      // The real defect is therefore the opposite of the one recorded: an
      // *unreachable* guard branch that reads as if it handles a failure it
      // cannot handle. Fixing it means making `isValidConfig` return false
      // (changing the public throw contract that 80 guard tests pin) or deleting
      // the dead branch. Neither belongs in this commit.
      for (const field of ['organization', 'sourceId', 'project', 'writeKey']) {
        expect(() => new IntemptJs({ ...CONFIG, [field]: '' })).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
      }
    });

    it('a config with a field missing entirely still constructs fully', () => {
      // The guard checks `=== ''`, so `undefined` passes. The instance is
      // complete — `_autoTracker` is set — and the failure surfaces later as a
      // 401 from ingest. Asserted to show the undefined-tracker state does not
      // arise here either.
      const instance = new IntemptJs({
        organization: 'acme',
        sourceId: 'src-1',
        project: 'proj-1',
      } as any);
      expect(() => instance.optOut()).not.toThrow();
      expect(autoTrackerInstances.at(-1)!.doNotTrack).toBe(true);
    });

    it('documents what WOULD happen if _autoTracker were ever undefined', () => {
      // Constructed off the prototype to bypass the constructor entirely. This
      // is not a reachable customer state (see above) — the assertion exists to
      // show *why* the §4 note was written: the methods genuinely have no guard,
      // so if any future refactor introduces an early return in the
      // constructor, this is the failure mode it produces.
      const bare = Object.create(IntemptJs.prototype) as InstanceType<typeof IntemptJs>;
      expect(() => bare.optIn()).toThrow(TypeError);
      expect(() => bare.optOut()).toThrow(TypeError);
      expect(() => bare.isUserOptIn()).toThrow(TypeError);
    });
  });

  function dispatchedNames() {
    return capture.seen.map((e) => e.name);
  }
});
