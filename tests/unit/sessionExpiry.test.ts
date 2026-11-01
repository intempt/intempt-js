import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-5992 (SDK-15): the first event after a session expires carried the
 * EXPIRED session id, and the new "Session start" came after it.
 *
 * The session cookie is sliding (30 min); when it expires the browser drops it,
 * but `storageHandler` keeps an in-memory mirror of the last value written. The
 * public methods read their ids (`IntemptJs._ids()` -> `getSessionId()`) before
 * they dispatch the activity event that makes the session tracker notice the
 * missing cookie and open a new session, so `getSessionId()` fell back to the
 * mirror: the old id. Only the NEXT event got the new one.
 *
 * Driven through a real `IntemptJs` and `AutoTrackerModule`; only the choices
 * engine and `fetch` are stubbed. Models are read off the `intempt:event` DOM
 * event, which is what the auto-tracker enqueues.
 */

vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: class {
    constructor(public config: unknown) {}
    init = async () => undefined;
  },
}));

const { IntemptJs } = await import('../../src/intemptJs/intemptJs.ts');

type Model = { name: string; payload?: { sessionId?: string }[] };

const CONFIG = {
  organization: 'acme',
  sourceId: 'src-session-expiry',
  project: 'proj-1',
  writeKey: 'wk-user.wk-pass',
  shopify: false,
  magento: false,
};

function expireSessionCookie() {
  // What the browser does when the sliding 30 min cookie runs out.
  document.cookie =
    'intempt_session=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
}

describe('first event after session expiry (INT-5992 SDK-15)', () => {
  const models: Model[] = [];
  const onEvent = (e: Event) =>
    models.push((e as CustomEvent).detail.event as Model);

  const sessionOf = (name: string) =>
    models.find((m) => m.name === name)?.payload?.[0]?.sessionId;

  async function sessionStarts(count: number) {
    for (let i = 0; i < 100; i++) {
      const starts = models.filter((m) => m.name === 'Session start');
      if (starts.length >= count) return starts;
      await new Promise((r) => setTimeout(r, 2));
    }
    return models.filter((m) => m.name === 'Session start');
  }

  beforeEach(() => {
    models.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    document.addEventListener('intempt:event', onEvent);
  });

  afterEach(() => {
    document.removeEventListener('intempt:event', onEvent);
    vi.unstubAllGlobals();
  });

  it('stamps the first event after expiry with the NEW session, the one its Session start opens', async () => {
    const sdk = new IntemptJs({ ...CONFIG });
    sdk.track({ eventTitle: 'e1', data: { n: 1 } } as any);
    const [firstStart] = await sessionStarts(1);
    const first = sessionOf('e1');
    expect(first).toBeTruthy();
    expect(firstStart!.payload![0]!.sessionId).toBe(first);

    expireSessionCookie();
    sdk.track({ eventTitle: 'e2', data: { n: 1 } } as any);

    const starts = await sessionStarts(2);
    expect(starts).toHaveLength(2);
    const second = sessionOf('e2');
    expect(second).not.toBe(first);
    expect(second).toBe(starts[1]!.payload![0]!.sessionId);
  });

  it('keeps the current session while the cookie is alive (no extra Session start)', async () => {
    const sdk = new IntemptJs({ ...CONFIG });
    sdk.track({ eventTitle: 'a1', data: { n: 1 } } as any);
    await sessionStarts(1);
    sdk.track({ eventTitle: 'a2', data: { n: 1 } } as any);
    sdk.identify({ userId: 'u-1' } as any);
    await new Promise((r) => setTimeout(r, 20));

    expect(models.filter((m) => m.name === 'Session start')).toHaveLength(1);
    expect(sessionOf('a2')).toBe(sessionOf('a1'));
    expect(sessionOf('Identify')).toBe(sessionOf('a1'));
  });

  it('names the event that opened the new session as its sessionStartEventName', async () => {
    const sdk = new IntemptJs({ ...CONFIG });
    sdk.track({ eventTitle: 'b1', data: { n: 1 } } as any);
    await sessionStarts(1);
    expireSessionCookie();
    sdk.productView('p-1');

    const starts = (await sessionStarts(2)) as (Model & {
      payload: { data: { sessionStartEventName: string } }[];
    })[];
    expect(starts[1]!.payload[0]!.data.sessionStartEventName).toBe(
      'Product viewed',
    );
  });
});
