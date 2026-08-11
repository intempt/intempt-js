import { describe, expect, it, vi } from 'vitest';
import {
  createPiiScrubber,
  DEFAULT_REDACTION,
  passesLuhn,
} from '../../src/shared/privacy/piiScrubber.ts';

const scrub = createPiiScrubber({ enabled: true });

describe('opt-in safety — the most important property in this file', () => {
  it('is the identity function when no options are given', () => {
    // Redaction rewrites data irreversibly *before* it leaves the browser. There is
    // no server-side undo, so a customer who upgrades the SDK and finds their
    // `email` field replaced has lost that data permanently. It can never default on.
    const payload = { email: 'someone@example.com', note: 'call +1 415 555 2671' };

    expect(createPiiScrubber()({ ...payload })).toEqual(payload);
  });

  it.each([[undefined], [false], [null], ['true'], [1]])(
    'stays off for enabled = %o — only the boolean true turns it on',
    (enabled) => {
      const payload = { email: 'someone@example.com' };
      expect(createPiiScrubber({ enabled: enabled as never })(payload)).toEqual(payload);
    },
  );

  it('returns the identical object reference when disabled, not a copy', () => {
    // Proof that the disabled path does no traversal at all, so the default
    // configuration pays nothing for this module beyond one closure call.
    const payload = { email: 'someone@example.com' };
    expect(createPiiScrubber({ enabled: false })(payload)).toBe(payload);
  });
});

describe('key-based redaction', () => {
  it('redacts a value by field name', () => {
    expect(scrub({ email: 'someone@example.com' })).toEqual({ email: DEFAULT_REDACTION });
  });

  it('matches field names case-insensitively', () => {
    expect(scrub({ EmailAddress: 'a@b.com', PHONE: '4155552671' })).toEqual({
      EmailAddress: DEFAULT_REDACTION,
      PHONE: DEFAULT_REDACTION,
    });
  });

  it.each(['password', 'ssn', 'cardNumber', 'cvv', 'apiKey', 'authorization', 'dob'])(
    'redacts the sensitive field name %s',
    (key) => {
      expect(scrub({ [key]: 'sensitive' })).toEqual({ [key]: DEFAULT_REDACTION });
    },
  );

  it('leaves the SDK\'s own identifiers alone, always', () => {
    // Redacting `profileId` would not protect the visitor — it would orphan the
    // event so ingest cannot attach it to anyone.
    const ids = {
      profileId: 'prof_123',
      sessionId: 'ses_456',
      pageId: 'pag_789',
      sourceId: 'src_1',
      eventId: 'ev_1',
      name: 'Page View',
      type: 'track',
      timestamp: 1754870000000,
    };

    expect(scrub(ids)).toEqual(ids);
  });

  it('exempts identifiers even when the customer names them as sensitive', () => {
    expect(
      createPiiScrubber({ enabled: true, additionalRedactKeys: ['profileId'] })({
        profileId: 'prof_123',
      }),
    ).toEqual({ profileId: 'prof_123' });
  });

  it('descends into a nested object under a sensitive key instead of collapsing it', () => {
    // Collapsing `{ email: {...} }` to a string would change the field's type on the
    // wire — a payload-shape change dressed up as redaction.
    expect(scrub({ email: { primary: 'a@b.com', verified: true } })).toEqual({
      email: { primary: DEFAULT_REDACTION, verified: true },
    });
  });

  it('leaves an undefined sensitive field undefined rather than inventing a value', () => {
    expect(scrub({ email: undefined })).toEqual({ email: undefined });
  });

  it('honours a custom redaction string', () => {
    expect(createPiiScrubber({ enabled: true, redaction: '***' })({ email: 'a@b.com' })).toEqual({
      email: '***',
    });
  });

  it('lets redactKeys replace the defaults entirely', () => {
    const custom = createPiiScrubber({ enabled: true, redactKeys: ['nickname'], patterns: [] });

    expect(custom({ nickname: 'ace', password: 'hunter2' })).toEqual({
      nickname: DEFAULT_REDACTION,
      password: 'hunter2',
    });
  });

  it('lets exemptKeys protect a field the defaults would redact', () => {
    expect(
      createPiiScrubber({ enabled: true, exemptKeys: ['token'] })({ token: 'keep-me' }),
    ).toEqual({ token: 'keep-me' });
  });
});

describe('pattern-based redaction — email', () => {
  it('redacts an address embedded in free text', () => {
    expect(scrub({ note: 'write to sam.o-brien+tag@mail.example.co.uk today' })).toEqual({
      note: `write to ${DEFAULT_REDACTION} today`,
    });
  });

  it('redacts every address in one string, not only the first', () => {
    // A `/g` regex reused across calls resumes from `lastIndex` unless reset. The
    // guard suites documented this exact bug once already.
    expect(scrub({ note: 'a@b.com and c@d.org' })).toEqual({
      note: `${DEFAULT_REDACTION} and ${DEFAULT_REDACTION}`,
    });
  });

  it('stays correct across repeated calls with the same scrubber', () => {
    // The regression the point above guards against, stated as a sequence.
    expect(scrub({ note: 'a@b.com' })).toEqual({ note: DEFAULT_REDACTION });
    expect(scrub({ note: 'a@b.com' })).toEqual({ note: DEFAULT_REDACTION });
    expect(scrub({ note: 'a@b.com' })).toEqual({ note: DEFAULT_REDACTION });
  });

  it.each(['not-an-email', 'a@b', '@example.com', 'user@', 'plain text'])(
    'leaves %o alone',
    (value) => {
      expect(scrub({ note: value })).toEqual({ note: value });
    },
  );
});

describe('pattern-based redaction — credit cards', () => {
  it.each([
    ['4111111111111111', 'Visa test number'],
    ['4111 1111 1111 1111', 'space-separated'],
    ['4111-1111-1111-1111', 'hyphen-separated'],
    ['5500005555555559', 'Mastercard test number'],
    ['378282246310005', 'Amex test number, 15 digits'],
  ])('redacts %s (%s)', (card) => {
    expect(scrub({ note: card })).toEqual({ note: DEFAULT_REDACTION });
  });

  it('redacts a card inside surrounding text without eating the text', () => {
    expect(scrub({ note: 'paid with 4111111111111111 ok' })).toEqual({
      note: `paid with ${DEFAULT_REDACTION} ok`,
    });
  });

  it('leaves a long digit run that fails Luhn alone', () => {
    // THE load-bearing assertion of this file. Order ids, microsecond timestamps
    // and concatenated identifiers all look like cards. Without the checksum this
    // rule would destroy legitimate analytics data to catch a card that was never
    // there — do not "simplify" the rule by dropping `verify`.
    expect(scrub({ orderId: '1234567890123456' })).toEqual({ orderId: '1234567890123456' });
    expect(scrub({ note: 'ref 9999999999999999' })).toEqual({ note: 'ref 9999999999999999' });
  });

  it('does not slice a card-shaped window out of a longer identifier', () => {
    const longer = 'id41111111111111119';
    expect(scrub({ note: longer })).toEqual({ note: longer });
  });

  it('rejects digit runs outside the 13–19 length window', () => {
    expect(passesLuhn('4111111111111')).toBe(false); // 13 digits, fails checksum
    expect(passesLuhn('411111111111')).toBe(false); // 12 digits — too short
    expect(passesLuhn('41111111111111111111')).toBe(false); // 20 digits — too long
  });

  it('accepts separators in the Luhn input', () => {
    expect(passesLuhn('4111 1111 1111 1111')).toBe(true);
    expect(passesLuhn('4111-1111-1111-1111')).toBe(true);
  });
});

describe('pattern-based redaction — phone numbers', () => {
  it.each([
    '+1 415 555 2671',
    '+14155552671',
    '+44 20 7183 8750',
    '(415) 555-2671',
    '415-555-2671',
    '415.555.2671',
  ])('redacts %s', (phone) => {
    expect(scrub({ note: phone })).toEqual({ note: DEFAULT_REDACTION });
  });

  it('leaves a bare 7-to-11 digit run alone', () => {
    // That shape collides with order numbers, zip+4 and epoch seconds. Redacting
    // those is a bigger loss than missing an unformatted phone number — a
    // deliberate recall/precision trade, recorded here so it is not "fixed" blind.
    expect(scrub({ orderNumber: '4155552671' })).toEqual({ orderNumber: '4155552671' });
    expect(scrub({ note: 'order 12345678' })).toEqual({ note: 'order 12345678' });
  });

  it('leaves a short number and a year alone', () => {
    expect(scrub({ note: 'in 2026 we had 42 signups' })).toEqual({
      note: 'in 2026 we had 42 signups',
    });
  });
});

describe('traversal', () => {
  it('walks nested objects and arrays', () => {
    expect(
      scrub({
        user: { contact: 'a@b.com' },
        events: [{ note: 'c@d.com' }, 'e@f.com'],
      }),
    ).toEqual({
      user: { contact: DEFAULT_REDACTION },
      events: [{ note: DEFAULT_REDACTION }, DEFAULT_REDACTION],
    });
  });

  it('leaves non-string scalars structurally intact', () => {
    const payload = { n: 42, b: false, z: null, u: undefined };
    expect(scrub(payload)).toEqual(payload);
  });

  it('does not rebuild a Date, which would change its type on the wire', () => {
    const date = new Date('2026-08-11T00:00:00Z');
    expect(scrub({ at: date }).at).toBe(date);
  });

  it('does not mutate the payload it was given', () => {
    // The queue may hold a reference to the original event object; mutating it in
    // place would redact data the caller still owns.
    const payload = { email: 'a@b.com', nested: { note: 'c@d.com' } };
    scrub(payload);

    expect(payload.email).toBe('a@b.com');
    expect(payload.nested.note).toBe('c@d.com');
  });

  it('handles a cyclic payload without hanging, via the depth cap', () => {
    const cyclic: Record<string, unknown> = { email: 'a@b.com' };
    cyclic.self = cyclic;

    expect(() => scrub(cyclic)).not.toThrow();
  });

  it('accepts a bare string or array as the whole payload', () => {
    expect(scrub('a@b.com')).toBe(DEFAULT_REDACTION);
    expect(scrub(['a@b.com'])).toEqual([DEFAULT_REDACTION]);
  });
});

describe('failure posture', () => {
  it('sends the payload unmodified rather than dropping it when a rule throws', () => {
    // A scrubber that throws on the send path does not leak data — it loses every
    // event behind it. "Possibly unredacted" beats "certainly dropped", because the
    // customer enabled this as a defence-in-depth layer, not their only one.
    const onFailure = vi.fn();
    const payload = { note: 'a@b.com' };

    const exploding = createPiiScrubber({
      enabled: true,
      patterns: [
        {
          name: 'boom',
          pattern: /x/g,
          verify: () => {
            throw new Error('bad rule');
          },
        },
      ],
      onFailure,
    });

    expect(exploding({ note: 'x' })).toEqual({ note: 'x' });
    expect(onFailure).toHaveBeenCalled();
    expect(exploding(payload)).toEqual(payload);
  });

  it('adds custom patterns on top of the defaults', () => {
    const withExtra = createPiiScrubber({
      enabled: true,
      additionalPatterns: [{ name: 'employee-id', pattern: /EMP-\d{5}/g }],
    });

    expect(withExtra({ note: 'EMP-12345 wrote to a@b.com' })).toEqual({
      note: `${DEFAULT_REDACTION} wrote to ${DEFAULT_REDACTION}`,
    });
  });
});
