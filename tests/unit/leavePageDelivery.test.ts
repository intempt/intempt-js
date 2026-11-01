import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * INT-5939 / INT-5942: a `Leave Page` must reach `/track` both on an SPA
 * navigation and on a hard unload, after its `View Page` was already sent.
 *
 * The Leave Page used to reuse the View Page's id as its `eventId`
 * (`eventId: pageId` in `PageEventModel`). The batcher remembers every sent
 * eventId and evicts a queued item whose id it has seen, so once the View Page
 * had been flushed — which on a real page is almost always, the flush interval
 * is 5 s — the Leave Page was thrown away before it was ever sent. Ingest dedupes
 * on the same id too (cdp-data-processor `MatcherDataItem.getDeduplicationKey`
 * is org + project + eventId, no event name), so even a Leave Page that slipped
 * past the batcher could be dropped as a repeat of its View Page.
 *
 * These run against a real `IntemptJs` with only `fetch` stubbed, so they cover
 * the whole path: page tracker -> auto tracker -> batcher -> transport.
 */

vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: class {
    constructor(public config: unknown) {}
    init = async () => undefined;
  },
}));

const { IntemptJs } = await import('../../src/intemptJs/intemptJs.ts');

type Call = { url: string; init: RequestInit };
type WireEntry = {
  eventId: string;
  pageId?: string;
  data?: { url?: string; timeOnPage?: number };
};
type WireEvent = { name: string; payload: WireEntry[] };

const CONFIG = {
  organization: 'acme',
  sourceId: 'src-leave',
  project: 'proj-1',
  writeKey: 'wk-user.wk-pass',
  shopify: false,
  magento: false,
};

const calls: Call[] = [];
const fetchStub = async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sentEvents(): WireEvent[] {
  return calls
    .filter((c) => c.url.includes('/track'))
    .flatMap((c) => JSON.parse(c.init.body as string).track as WireEvent[]);
}

function entriesNamed(name: string): WireEntry[] {
  return sentEvents()
    .filter((e) => e.name === name)
    .flatMap((e) => e.payload);
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return;
    await sleep(10);
  }
}

/** Flush the queue the way a live page does when the tab is backgrounded. */
async function visibilityFlush(): Promise<void> {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  // Bubbles, as the browser's does, so the transport's window listener sees it.
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  await sleep(100);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
}

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const event = new Event(type) as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

describe('Leave Page delivery (INT-5939, INT-5942)', () => {
  let sdk: InstanceType<typeof IntemptJs>;
  let firstView: WireEntry;

  // `tests/unit/setup.ts` expires every cookie before each test. The steps here
  // are one visit to one site, so the session and page cookies are carried
  // across instead of every test starting a new session mid-page.
  let cookies: string[] = [];
  const saveCookies = () => {
    cookies = document.cookie
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);
  };
  afterEach(saveCookies);

  beforeAll(async () => {
    window.history.replaceState({}, '', 'http://localhost:3000/a');
    vi.stubGlobal('fetch', fetchStub);
    sdk = new IntemptJs({ ...CONFIG });
    await sleep(100);

    // Get the bootstrap View Page out first. Nothing about a visibility flush
    // creates a Leave Page, so the View Page's id is in the batcher's sent set
    // before any test navigates — the normal state of a page after 5 s.
    await visibilityFlush();
    await waitFor(() => entriesNamed('View Page').length > 0);
    firstView = entriesNamed('View Page')[0]!;
    saveCookies();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    for (const cookie of cookies) document.cookie = `${cookie};path=/`;
    vi.stubGlobal('fetch', fetchStub);
  });

  it('INT-5939: an SPA navigation delivers the Leave Page of a View Page that was already sent', async () => {
    expect(firstView).toBeDefined();
    calls.length = 0;

    window.history.pushState({}, '', '/p2');
    await waitFor(() => entriesNamed('Leave Page').length > 0);

    const leaves = entriesNamed('Leave Page');
    expect(leaves).toHaveLength(1);
    const leave = leaves[0]!;
    // Linked to the page it ends through pageId, not through a shared eventId.
    expect(leave.pageId).toBe(firstView.pageId);
    expect(leave.eventId).not.toBe(firstView.eventId);
    // It reports the page being left, not the one just navigated to.
    expect(leave.data?.url).toBe('http://localhost:3000/a');
  });

  it('INT-5942: a hard unload delivers the pending event and a Leave Page in a keepalive request', async () => {
    // The /p2 View Page goes out first, so this page's View Page is "sent" too —
    // the case that used to lose its Leave Page.
    await visibilityFlush();
    await waitFor(() =>
      entriesNamed('View Page').some((e) => e.data?.url?.endsWith('/p2')),
    );
    calls.length = 0;

    sdk.track({ eventTitle: 'e1', data: { step: 1 } });
    await sleep(20);
    // A full navigation away. beforeunload is deliberately not dispatched:
    // mobile browsers skip it for most unloads, pagehide always fires.
    pageTransition('pagehide', false);

    await waitFor(
      () =>
        entriesNamed('Leave Page').length > 0 && entriesNamed('e1').length > 0,
    );

    expect(entriesNamed('e1')).toHaveLength(1);
    const leaves = entriesNamed('Leave Page');
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.data?.url).toBe('http://localhost:3000/p2');
    const leaveCall = calls.find((c) =>
      (c.init.body as string).includes('"Leave Page"'),
    );
    expect(leaveCall?.init.keepalive).toBe(true);
  });

  it('INT-5942: beforeunload followed by pagehide sends one Leave Page, not two', async () => {
    // A bfcache restore opens a new view of the same URL.
    calls.length = 0;
    pageTransition('pageshow', true);
    await sleep(20);
    await visibilityFlush();
    await waitFor(() => entriesNamed('View Page').length > 0);
    expect(entriesNamed('View Page')).toHaveLength(1);
    calls.length = 0;

    window.dispatchEvent(new Event('beforeunload'));
    pageTransition('pagehide', false);

    await waitFor(() => entriesNamed('Leave Page').length > 0);
    await sleep(200);

    expect(entriesNamed('Leave Page')).toHaveLength(1);
  });
});
