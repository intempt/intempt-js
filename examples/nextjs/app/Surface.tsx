'use client';

import { useState } from 'react';
import { analytics } from './intempt/analytics';

/**
 * Every method on the surface, called once.
 *
 * This is the file that makes the wrapper's signatures a compile-time check: if
 * the SDK's shape changes and `analytics.ts` is not updated, this stops
 * compiling. The Intempt CLI's compile gate typechecks this directory for
 * exactly that reason.
 */
export function Surface() {
  const [optedIn, setOptedIn] = useState<boolean | undefined>(undefined);
  const [feed, setFeed] = useState<unknown>(null);

  return (
    <section>
      <h2>The whole surface</h2>

      <button
        onClick={() => {
          // Identity
          analytics.identify('user_1', { plan: 'pro' });
          analytics.group('acct_1', { company_name: 'Acme' });
        }}
      >
        identify / group
      </button>

      <button
        onClick={() => {
          // Events. `data` must be non-empty — the SDK throws on `{}`.
          analytics.track('cta_clicked', { placement: 'hero' });
          analytics.record('invoice_paid', {
            userId: 'user_1',
            accountId: 'acct_1',
            data: { amount_cents: 12900 },
          });
        }}
      >
        track / record
      </button>

      <button
        onClick={() => {
          // Commerce. productView takes a bare string; the others take objects.
          analytics.productView('sku_1');
          analytics.productAdd({ productId: 'sku_1', quantity: 2 });
          analytics.productOrdered([
            { productId: 'sku_1', quantity: 2 },
            { productId: 'sku_2' },
          ]);
        }}
      >
        productView / productAdd / productOrdered
      </button>

      <button
        onClick={() => {
          // Consent. `action` is case-sensitive; 'Accept' throws at runtime.
          analytics.consent('accept', 1798761600, { email: 'user@acme.com' });
        }}
      >
        consent
      </button>

      <button
        onClick={() => {
          analytics.optOut();
          setOptedIn(analytics.isUserOptIn());
        }}
      >
        optOut
      </button>

      <button
        onClick={() => {
          analytics.optIn();
          setOptedIn(analytics.isUserOptIn());
        }}
      >
        optIn
      </button>

      <button onClick={() => analytics.logOut()}>logOut</button>

      <button
        onClick={() => {
          analytics
            .recommendation({
              id: 1,
              quantity: 4,
              fields: ['productId', 'title', 'price'],
            })
            .then(setFeed)
            .catch((error: unknown) => setFeed(String(error)));
        }}
      >
        recommendation
      </button>

      <p>
        opted in: <code>{String(optedIn)}</code>
      </p>
      {feed ? <pre>{JSON.stringify(feed, null, 2)}</pre> : null}
    </section>
  );
}
