/**
 * The Next.js example's wrapper, run against the SDK's real guards.
 *
 * This file exists because `tsc` and `next build` both passed on a wrapper whose
 * every `identify` and `group` call threw at runtime: the guards require an
 * `eventTitle` alongside `userAttributes`/`accountAttributes`, and that is a
 * runtime rule no type can express. A compiling example is not a working one.
 *
 * The stand-in for `window.intempt` here is not a mock of the surface — it pipes
 * each call into the actual guard from `src/`, so a guard change breaks this test
 * rather than silently invalidating the example.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { IntemptJsGuard } from '../../src/intemptJs/guards/intemptJs.guard';
import { analytics } from '../../examples/nextjs/app/intempt/analytics';

const guard = new IntemptJsGuard();

/** Records what the wrapper sent, after the real guard has accepted it. */
let sent: Array<{ method: string; params: unknown }>;

beforeEach(() => {
  sent = [];
  const record = (method: string) => (params: unknown) => {
    sent.push({ method, params });
  };

  (globalThis as { window?: unknown }).window = {
    intempt: {
      identify: (params: never) => {
        guard.isIdentifyValid(params);
        record('identify')(params);
      },
      group: (params: never) => {
        guard.isGroupValid(params);
        record('group')(params);
      },
      track: (params: never) => {
        guard.isTrackValid(params);
        record('track')(params);
      },
      record: record('record'),
      alias: record('alias'),
      consent: (params: never) => {
        guard.isConsentValid(params);
        record('consent')(params);
      },
      productAdd: record('productAdd'),
      productView: record('productView'),
      productOrdered: record('productOrdered'),
      optIn: () => record('optIn')(undefined),
      optOut: () => record('optOut')(undefined),
      isUserOptIn: () => true,
      logOut: () => record('logOut')(undefined),
      recommendation: (params: unknown) => {
        record('recommendation')(params);
        return Promise.resolve([]);
      },
    },
  };
});

describe('identify', () => {
  it('passes the guard when traits are sent', () => {
    expect(() => analytics.identify('u1', { plan: 'pro' })).not.toThrow();
  });

  it('sends an eventTitle alongside userAttributes, as the guard demands', () => {
    analytics.identify('u1', { plan: 'pro' });
    expect(sent[0].params).toMatchObject({
      userId: 'u1',
      eventTitle: 'Identify user',
      userAttributes: { plan: 'pro' },
    });
  });

  it('omits eventTitle entirely when there are no traits', () => {
    analytics.identify('u1');
    expect(sent[0].params).toEqual({ userId: 'u1' });
  });

  it('accepts a caller-supplied eventTitle', () => {
    analytics.identify('u1', { plan: 'pro' }, 'Signed up');
    expect(sent[0].params).toMatchObject({ eventTitle: 'Signed up' });
  });

  it('still rejects an empty userId, which is the guard talking', () => {
    expect(() => analytics.identify('', { plan: 'pro' })).toThrow(
      /'userId' is required/,
    );
  });
});

describe('group', () => {
  it('passes the guard when attributes are sent', () => {
    expect(() =>
      analytics.group('acct_1', { company_name: 'Acme' }),
    ).not.toThrow();
  });

  it('sends an eventTitle alongside accountAttributes', () => {
    analytics.group('acct_1', { company_name: 'Acme' });
    expect(sent[0].params).toMatchObject({
      accountId: 'acct_1',
      eventTitle: 'Identify account',
      accountAttributes: { company_name: 'Acme' },
    });
  });

  it('omits eventTitle entirely when there are no attributes', () => {
    analytics.group('acct_1');
    expect(sent[0].params).toEqual({ accountId: 'acct_1' });
  });
});

describe('track', () => {
  it('passes the guard with non-empty data', () => {
    expect(() =>
      analytics.track('cta_clicked', { placement: 'hero' }),
    ).not.toThrow();
  });

  it('surfaces the guard rejection of empty data rather than hiding it', () => {
    expect(() => analytics.track('cta_clicked', {})).toThrow(/can't be empty/);
  });
});

// consent() records a decision; it does not stop collection. A banner built on
// consent() alone keeps sending events after a rejection.
describe('consent', () => {
  it('opts in before recording an accept', () => {
    analytics.consent('accept', 1798761600000);
    expect(sent.map((call) => call.method)).toEqual(['optIn', 'consent']);
  });

  it('opts out after recording a reject', () => {
    analytics.consent('reject', 1798761600000);
    expect(sent.map((call) => call.method)).toEqual(['consent', 'optOut']);
  });

  it('passes validUntil through as milliseconds', () => {
    analytics.consent('accept', 1798761600000);
    expect(sent[1].params).toMatchObject({ validUntil: 1798761600000 });
  });

  it('lets the guard reject a miscased action', () => {
    expect(() =>
      analytics.consent('Accept' as 'accept', 1798761600000),
    ).toThrow();
  });
});

describe('the rest of the surface', () => {
  it('reaches every remaining method', () => {
    analytics.alias('u1', 'anon_1');
    analytics.record('invoice_paid', { userId: 'u1', data: { cents: 1 } });
    analytics.productView('sku_1');
    analytics.productAdd({ productId: 'sku_1', quantity: 2 });
    analytics.productOrdered([{ productId: 'sku_1' }]);
    analytics.optIn();
    analytics.optOut();
    analytics.logOut();

    expect(analytics.isUserOptIn()).toBe(true);
    expect(sent.map((call) => call.method)).toEqual([
      'alias',
      'record',
      'productView',
      'productAdd',
      'productOrdered',
      'optIn',
      'optOut',
      'logOut',
    ]);
  });

  it('returns a promise from recommendation', async () => {
    await expect(
      analytics.recommendation({ id: 1, quantity: 4, fields: ['productId'] }),
    ).resolves.toEqual([]);
  });
});

describe('server rendering', () => {
  it('throws a message naming the cause when window is absent', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => analytics.track('x', { a: 1 })).toThrow(/server rendering/);
  });

  it('names localhost when the SDK never installed', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => analytics.track('x', { a: 1 })).toThrow(/localhost/);
  });
});
