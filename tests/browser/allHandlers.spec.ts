import { test, expect, loadSdk } from './fixtures.ts';

/**
 * **Every public handler, in a real browser, checked for the identity fields ingest
 * needs.**
 *
 * The unit tier's golden fixtures (`tests/unit/__golden__/payload/`) already pin the
 * exact wire shape per method, and they are the contract. What they cannot answer is
 * the question this spec exists for: **if a page calls everything the SDK exposes, in
 * one session, does every resulting event still leave the browser carrying a complete
 * and consistent identity?**
 *
 * That is a different failure mode from a wrong field name. The ids are minted by
 * three different collaborators — `profileId` from a cookie, `sessionId` from the
 * session tracker, `pageId` from the page tracker — and each is read fresh per call
 * via `_ids()`. A cookie that fails to write, a session that rotates mid-batch, or a
 * page tracker that returns undefined produces events that are individually
 * well-formed and collectively unjoinable: ingest cannot attribute them to one
 * visitor, and the loss is invisible until someone queries the data.
 *
 * So the assertions here are about **presence, non-emptiness and consistency across
 * the whole batch**, not about field-by-field shape.
 *
 * One method is deliberately not called: `optOut()`. It suppresses every subsequent
 * handler, which is its job — calling it mid-spec would silently empty the rest of
 * the batch and the suite would still pass. Opt-out behaviour belongs in the unit
 * tier, where it can be asserted rather than merely survived.
 */

/** Every identity field ingest joins on. Absent or empty, the event is orphaned. */
const IDENTITY_FIELDS = [
  'eventId',
  'sessionId',
  'pageId',
  'profileId',
] as const;

/**
 * **`Session start` carries no `pageId`, and that is pre-existing asserted
 * behaviour** — `tests/unit/__golden__/payload/bootstrap-autotracked.json` records
 * exactly that shape, while the `View Page` event beside it has all four.
 * `SessionEventModel` simply does not set one.
 *
 * Called out rather than quietly excluded, because the consequence is real: a
 * session-start event cannot be joined to the page the session started on. It
 * belongs to the same family as D-1/D-3/D-15 — wire-format facts that need the
 * ingest conversation before they can change — so this spec asserts the *current*
 * contract and will fail, deliberately, on the day it is fixed.
 */
const NO_PAGE_ID = new Set(['Session start']);

type Entry = {
  name?: string;
  type?: string;
  payload?: Record<string, unknown>[];
};

/** Flatten every ingest request into its individual `track` entries. */
function entriesFrom(ingested: unknown[]): Entry[] {
  return ingested.flatMap((body) => {
    const track = (body as { track?: Entry[] } | null)?.track;
    return Array.isArray(track) ? track : [];
  });
}

test('every handler delivers events carrying a complete, consistent identity', async ({
  page,
  harness,
}) => {
  await loadSdk(page);

  // Called the way a customer's page would, through `window.intempt`, with the
  // signatures `IntemptJsGuard` actually accepts. A signature the guard rejects
  // throws on the customer's own stack, so getting these right is part of the test.
  await page.evaluate(async () => {
    const sdk = window.intempt;
    if (!sdk) throw new Error('SDK did not install itself');

    sdk.identify({
      userId: 'user-e2e-1',
      eventTitle: 'Signed Up',
      userAttributes: { email: 'ada@example.com', plan: 'pro' },
      data: { source: 'browser-tier' },
    });

    sdk.group({
      accountId: 'acct-e2e-1',
      eventTitle: 'Joined Account',
      accountAttributes: { tier: 'enterprise' },
    });

    sdk.track({
      eventTitle: 'Signup Clicked',
      data: { plan: 'pro', seats: 3 },
    });

    sdk.record({
      eventTitle: 'Recorded Event',
      userId: 'user-e2e-1',
      accountId: 'acct-e2e-1',
      data: { note: 'browser-tier' },
    });

    sdk.consent({
      action: 'accept',
      validUntil: Date.now() + 86_400_000,
      email: 'ada@example.com',
      category: 'analytics',
    });

    sdk.productView('sku-1');
    sdk.productAdd({ productId: 'sku-1', quantity: 2 });
    sdk.productOrdered([
      { productId: 'sku-1', quantity: 2 },
      { productId: 'sku-2', quantity: 1 },
    ]);

    // Async, and allowed to fail: what matters is that it does not throw into the
    // page and does not disturb the batch behind it.
    await sdk
      .recommendation({ id: 1, quantity: 3, fields: ['name'] })
      .catch(() => null);

    // `logOut()` refreshes the trackers, which rotates the session. Called last on
    // purpose: it is the one handler that legitimately changes the identity, so
    // running it earlier would make the consistency assertion below meaningless
    // rather than failing honestly.
    sdk.logOut();
  });

  // Auto-tracked events plus ten manual calls; the batcher decides when to send.
  // Poll for the batch rather than sleeping — §0c is a list of five CI failures
  // where a fixed wait was the difference between green and red.
  await expect
    .poll(() => entriesFrom(harness.ingested()).length, {
      timeout: 20_000,
      message: 'no events reached ingest at all',
    })
    .toBeGreaterThan(0);

  // Nothing may throw into the host page while all of that happens.
  expect(harness.pageErrors()).toEqual([]);

  const entries = entriesFrom(harness.ingested());
  const payloads = entries.flatMap((entry) => entry.payload ?? []);
  expect(payloads.length).toBeGreaterThan(0);

  // 1. Every event carries every identity field, non-empty.
  for (const [index, payload] of payloads.entries()) {
    const owner = entries.find((entry) => entry.payload?.includes(payload));
    const required = NO_PAGE_ID.has(owner?.name ?? '')
      ? IDENTITY_FIELDS.filter((field) => field !== 'pageId')
      : IDENTITY_FIELDS;

    for (const field of required) {
      const value = payload[field];
      expect(
        typeof value === 'string' && value.length > 0,
        `entry ${index} (${owner?.name ?? 'unknown'}) is missing ${field}: ${JSON.stringify(payload[field])}`,
      ).toBe(true);
    }
  }

  // 2a. The session-event exception is asserted in the positive direction too, so
  //     the exemption above cannot quietly widen into "pageId is optional".
  for (const entry of entries) {
    if (NO_PAGE_ID.has(entry.name ?? '')) continue;
    for (const payload of entry.payload ?? []) {
      expect(
        typeof payload.pageId === 'string' && payload.pageId.length > 0,
        `${entry.name} should carry a pageId and does not`,
      ).toBe(true);
    }
  }

  // 2. Every event names itself. An unnamed or untyped entry is unclassifiable at
  //    ingest even when its ids are perfect.
  for (const entry of entries) {
    expect(typeof entry.name === 'string' && entry.name.length > 0).toBe(true);
  }

  // 3. `profileId` is the same across the whole session. It is the visitor, and it
  //    comes from a cookie — a failed cookie write shows up here and nowhere else.
  const profileIds = new Set(payloads.map((p) => p.profileId));
  expect(
    profileIds.size,
    `profileId split across the batch: ${[...profileIds].join(', ')}`,
  ).toBe(1);

  // 4. `eventId` is unique per event — the batcher dedupes on it, so a repeat is a
  //    droppable event. (D-3 is the known exception: session events share the
  //    session id. That is asserted in the unit tier; here we check the manual
  //    handlers, which are the ones this spec drives.)
  const eventIds = payloads.map((p) => p.eventId as string);
  const duplicated = eventIds.filter(
    (id, index) => eventIds.indexOf(id) !== index,
  );
  const duplicatedManual = duplicated.filter((id) => {
    const owner = entries.find((entry) =>
      entry.payload?.some((p) => p.eventId === id),
    );
    return owner?.type !== 'session';
  });
  expect(
    duplicatedManual,
    `these eventIds repeat and are therefore droppable by the batcher's dedupe`,
  ).toEqual([]);
});

test('the manual handlers each reach ingest with their own fields', async ({
  page,
  harness,
}) => {
  await loadSdk(page);

  await page.evaluate(() => {
    const sdk = window.intempt;
    sdk?.identify({ userId: 'user-fields', eventTitle: 'Identify Fields' });
    sdk?.group({ accountId: 'acct-fields', eventTitle: 'Group Fields' });
    sdk?.track({ eventTitle: 'Track Fields', data: { a: 1 } });
  });

  await harness.waitForEvent('Track Fields');

  const payloadsByName = new Map<string, Record<string, unknown>>();
  for (const entry of entriesFrom(harness.ingested())) {
    if (entry.name && entry.payload?.[0]) {
      payloadsByName.set(entry.name, entry.payload[0]);
    }
  }

  // The method-specific field, on top of the shared identity. This is the narrow
  // version of the golden fixtures — enough to catch a handler that delivers an
  // event with no trace of what it was called with.
  expect(payloadsByName.get('Identify Fields')?.userId).toBe('user-fields');
  expect(payloadsByName.get('Group Fields')?.accountId).toBe('acct-fields');
  expect(payloadsByName.get('Track Fields')?.data).toEqual({ a: 1 });
});

test('a full batch is delivered in one uninterrupted run of requests', async ({
  page,
  harness,
}) => {
  await loadSdk(page);

  await page.evaluate(() => {
    const sdk = window.intempt;
    for (let index = 0; index < 25; index++) {
      sdk?.track({ eventTitle: `Bulk ${index}`, data: { index } });
    }
  });

  // 25 events cross the batch-size boundary, so this exercises the multi-request
  // path rather than a single flush. Every one must arrive: a partial delivery here
  // is the batcher dropping events, which is the failure the bounded queue and the
  // circuit breaker exist to make visible rather than silent.
  await expect
    .poll(
      () => {
        const names = new Set(
          entriesFrom(harness.ingested()).map((entry) => entry.name),
        );
        return Array.from({ length: 25 }, (_, i) => `Bulk ${i}`).filter(
          (name) => names.has(name),
        ).length;
      },
      { timeout: 30_000, message: 'not every bulk event reached ingest' },
    )
    .toBe(25);

  expect(harness.pageErrors()).toEqual([]);
});
