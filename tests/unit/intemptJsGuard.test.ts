import { describe, expect, it, beforeEach } from 'vitest';
import { IntemptJsGuard } from '../../src/intemptJs/guards/intemptJs.guard.ts';

/**
 * Public-API parameter validation — tier 1.
 *
 * **This module had no test anywhere before this file.** The CHECKPOINT's note
 * that "the guards already have 91 Cypress assertions" was about
 * `src/guard/**` (tracking guards); `src/intemptJs/guards/**` was never covered
 * by either tier, despite being the validation layer every public method calls
 * first — `track`, `identify`, `group`, `record`, `consent`.
 *
 * These guards throw rather than return false, and those throws surface in the
 * customer's own call stack, so the message text is part of the public contract.
 * The assertions below pin the exact strings for that reason.
 */

describe('IntemptJsGuard', () => {
  let guard: IntemptJsGuard;

  beforeEach(() => {
    guard = new IntemptJsGuard();
  });

  describe('isValidConfig', () => {
    const valid = {
      organization: 'org',
      sourceId: 'src',
      project: 'proj',
      writeKey: 'u.p',
    };

    it('accepts a fully populated config', () => {
      expect(guard.isValidConfig(valid)).toBe(true);
    });

    it.each(['organization', 'sourceId', 'project', 'writeKey'])(
      'rejects an empty %s',
      (field) => {
        expect(() => guard.isValidConfig({ ...valid, [field]: '' })).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
      },
    );

    it.each(['organization', 'sourceId', 'project', 'writeKey'])(
      'rejects a config with %s missing entirely — D-25 fixed',
      (field) => {
        // The check was `=== ''`, so `undefined` and an absent key both passed. A
        // snippet omitting `writeKey` therefore constructed successfully and failed
        // later at request time with a 401 instead of at init with a clear error.
        const partial: Record<string, string> = { ...valid };
        delete partial[field];
        expect(() => guard.isValidConfig(partial)).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
        expect(() =>
          guard.isValidConfig({ ...valid, [field]: undefined }),
        ).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
      },
    );

    it('rejects a non-string field, and rejects a nullish params object', () => {
      // `typeof !== 'string'` also closes the shapes a JSON-driven integration can
      // produce — a numeric sourceId, or a null writeKey from a templating layer.
      expect(() => guard.isValidConfig({ ...valid, sourceId: 42 })).toThrow();
      expect(() => guard.isValidConfig({ ...valid, writeKey: null })).toThrow();
      // And it must not itself throw a TypeError on no config at all.
      expect(() => guard.isValidConfig(undefined)).toThrow(
        'IntemptJs initialization failed: All config fields must be provided.',
      );
    });
  });

  describe('isConsentValid', () => {
    it('accepts accept and reject', () => {
      expect(guard.isConsentValid({ action: 'accept' } as never)).toBe(true);
      expect(guard.isConsentValid({ action: 'reject' } as never)).toBe(true);
    });

    it.each([undefined, null, {}])('rejects %s params', (params) => {
      expect(() => guard.isConsentValid(params as never)).toThrow(
        "Parameters for the 'consent' method are required.",
      );
    });

    it('rejects a missing action', () => {
      expect(() =>
        guard.isConsentValid({ action: undefined, x: 1 } as never),
      ).toThrow('Consent parameters are invalid: action is required.');
    });

    it('rejects any other action value, including case variants', () => {
      expect(() => guard.isConsentValid({ action: 'maybe' } as never)).toThrow(
        'Consent parameters are invalid: action should be either "reject" or "accept".',
      );
      expect(() => guard.isConsentValid({ action: 'Accept' } as never)).toThrow(
        'action should be either "reject" or "accept"',
      );
    });
  });

  describe('isIdentifyValid', () => {
    it('accepts a userId alone', () => {
      expect(guard.isIdentifyValid({ userId: 'u1' } as never)).toBe(true);
    });

    it('accepts userAttributes when an eventTitle is present', () => {
      expect(
        guard.isIdentifyValid({
          userId: 'u1',
          eventTitle: 'signed up',
          userAttributes: { plan: 'pro' },
        } as never),
      ).toBe(true);
    });

    it.each([undefined, null, {}])('rejects %s params', (params) => {
      expect(() => guard.isIdentifyValid(params as never)).toThrow(
        "Parameters for the 'identify' method are required.",
      );
    });

    it('rejects a missing or empty userId', () => {
      expect(() => guard.isIdentifyValid({ eventTitle: 'x' } as never)).toThrow(
        "Identify parameters are invalid: 'userId' is required.",
      );
      expect(() => guard.isIdentifyValid({ userId: '' } as never)).toThrow(
        "'userId' is required",
      );
    });

    it('rejects userAttributes with no eventTitle to attach them to', () => {
      expect(() =>
        guard.isIdentifyValid({
          userId: 'u1',
          userAttributes: { plan: 'pro' },
        } as never),
      ).toThrow(
        "Identify parameters are invalid: set 'eventTitle' to use 'userAttributes'.",
      );
    });
  });

  describe('isGroupValid', () => {
    it('accepts an accountId alone', () => {
      expect(guard.isGroupValid({ accountId: 'a1' } as never)).toBe(true);
    });

    it('accepts accountId 0 and empty string, unlike identify', () => {
      // Group checks `=== undefined || === null` while identify checks
      // falsiness, so these two methods disagree about 0 and ''. Pinned because
      // it is a real inconsistency in the public API, not a typo in the test.
      expect(guard.isGroupValid({ accountId: 0 } as never)).toBe(true);
      expect(guard.isGroupValid({ accountId: '' } as never)).toBe(true);
    });

    it.each([undefined, null, {}])('rejects %s params', (params) => {
      expect(() => guard.isGroupValid(params as never)).toThrow(
        "Parameters for the 'group' method are required.",
      );
    });

    it('rejects a missing accountId', () => {
      expect(() => guard.isGroupValid({ eventTitle: 'x' } as never)).toThrow(
        "Group parameters are invalid: 'accountId' is required.",
      );
    });

    it('rejects accountAttributes with no eventTitle', () => {
      expect(() =>
        guard.isGroupValid({
          accountId: 'a1',
          accountAttributes: { tier: 'gold' },
        } as never),
      ).toThrow(
        "Group parameters are invalid: set 'eventTitle' to use 'accountAttributes'.",
      );
    });
  });

  describe('isTrackValid', () => {
    it('accepts an eventTitle with non-empty data', () => {
      expect(
        guard.isTrackValid({
          eventTitle: 'added to cart',
          data: { sku: 'x' },
        } as never),
      ).toBe(true);
    });

    it.each([undefined, null, {}])('rejects %s params', (params) => {
      expect(() => guard.isTrackValid(params as never)).toThrow(
        "Parameters for the 'track' method are required.",
      );
    });

    it('rejects a missing eventTitle', () => {
      expect(() => guard.isTrackValid({ data: { a: 1 } } as never)).toThrow(
        'Track parameters are invalid: eventTitle is required.',
      );
    });

    it.each([undefined, null, {}])('rejects %s data', (data) => {
      expect(() =>
        guard.isTrackValid({ eventTitle: 'x', data } as never),
      ).toThrow("Track parameters are invalid: 'data' can't be empty.");
    });
  });

  describe('isRecordValid', () => {
    it('accepts an eventTitle with no data — unlike track', () => {
      expect(guard.isRecordValid({ eventTitle: 'viewed' } as never)).toBe(true);
    });

    it.each([undefined, null, {}])('rejects %s params', (params) => {
      expect(() => guard.isRecordValid(params as never)).toThrow(
        "Parameters for the 'record' method are required.",
      );
    });

    it('rejects a missing eventTitle', () => {
      expect(() => guard.isRecordValid({ data: {} } as never)).toThrow(
        'Record parameters are invalid: eventTitle is required.',
      );
    });
  });


  describe('forbidden event titles', () => {
    /**
     * These names are the ones the SDK's own autotracker emits. A customer
     * reusing one would merge their events into an internal stream, so the
     * guard rejects them — and it must stay case-insensitive, because the
     * autotracker's own casing is not what a customer would type.
     */
    const FORBIDDEN = [
      'auto-track',
      'view page',
      'leave page',
      'change on',
      'click on',
      'submit on',
      'identify',
      'consent',
    ];

    it.each(FORBIDDEN)('track rejects "%s"', (title) => {
      expect(() =>
        guard.isTrackValid({ eventTitle: title, data: { a: 1 } } as never),
      ).toThrow(`The '${title}' event title is forbidden`);
    });

    it.each(FORBIDDEN)('record rejects "%s"', (title) => {
      expect(() => guard.isRecordValid({ eventTitle: title } as never)).toThrow(
        `The '${title}' event title is forbidden`,
      );
    });

    it.each(FORBIDDEN)('identify rejects "%s"', (title) => {
      expect(() =>
        guard.isIdentifyValid({ userId: 'u1', eventTitle: title } as never),
      ).toThrow(`The '${title}' event title is forbidden`);
    });

    it.each(FORBIDDEN)('group rejects "%s"', (title) => {
      expect(() =>
        guard.isGroupValid({ accountId: 'a1', eventTitle: title } as never),
      ).toThrow(`The '${title}' event title is forbidden`);
    });

    it("matches case-insensitively but reports the caller's casing", () => {
      expect(() =>
        guard.isTrackValid({
          eventTitle: 'View Page',
          data: { a: 1 },
        } as never),
      ).toThrow("The 'View Page' event title is forbidden");
      expect(() =>
        guard.isTrackValid({ eventTitle: 'CLICK ON', data: { a: 1 } } as never),
      ).toThrow("The 'CLICK ON' event title is forbidden");
    });

    it('does not reject a title that merely contains a forbidden name', () => {
      // Substring matching here would reject legitimate titles like
      // "user consent updated". The check is exact-match on the whole title.
      expect(
        guard.isTrackValid({
          eventTitle: 'consent banner shown',
          data: { a: 1 },
        } as never),
      ).toBe(true);
      expect(
        guard.isTrackValid({
          eventTitle: 'identify user',
          data: { a: 1 },
        } as never),
      ).toBe(true);
    });

    it('checks the forbidden list before requiring userId in identify', () => {
      // Order of checks is itself a contract: a caller passing a forbidden title
      // AND no userId should hear about the title, since that is the mistake
      // they are less likely to spot themselves.
      expect(() =>
        guard.isIdentifyValid({ eventTitle: 'identify' } as never),
      ).toThrow("The 'identify' event title is forbidden");
    });
  });
});
