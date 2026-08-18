'use client';

import { useState } from 'react';
import { analytics } from './intempt/analytics';

/**
 * A client component, because the SDK lives on `window`.
 *
 * Calling it from a server component is the mistake this example is shaped to
 * prevent: the module would evaluate on the server, where `window` is undefined
 * and `analytics` throws with that as the message.
 */
export function SignupForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        // `identify` is enough here: the SDK stamps the anonymous profile id on
        // the event itself, so the history follows without an explicit alias.
        // `alias` is for merging two ids you already hold — see Surface.tsx.
        analytics.identify(email, {
          plan: 'pro',
          signup_source: 'nextjs-example',
        });
        analytics.group('acct_acme', { company_name: 'Acme', seat_count: 12 });

        analytics.track('signup_submitted', { plan: 'pro', source_page: '/' });

        setSent(true);
      }}
    >
      <input
        type="email"
        required
        value={email}
        placeholder="you@company.com"
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit">Sign up</button>
      {sent ? <p>Sent. Check the network tab.</p> : null}
    </form>
  );
}
