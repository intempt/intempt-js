import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOptInOut,
  hasOptedIn,
  hasOptedOut,
  optIn,
  optOut,
  resetConsentNotices,
} from '../../src/shared/privacy/gdpr.ts';
import { loadStoredConsent } from '../../src/shared/consentState.ts';

/** A window with DNT on, injected rather than mutating jsdom's shared navigator. */
const DNT_ON = { navigator: { doNotTrack: '1' } } as unknown as Window &
  typeof globalThis;
const GPC_ON = {
  navigator: { globalPrivacyControl: true },
} as unknown as Window & typeof globalThis;
const NO_SIGNAL = { navigator: {} } as unknown as Window & typeof globalThis;

describe('the consent decision table, ported from gdpr-utils', () => {
  beforeEach(() => {
    clearOptInOut();
    resetConsentNotices();
  });

  it('does not suppress tracking for a visitor who has never been asked', () => {
    // Tracking-by-default is this SDK's documented behaviour, so "never asked"
    // must not read as an opt-out.
    expect(hasOptedOut({ win: NO_SIGNAL })).toBe(false);
    expect(hasOptedIn()).toBe(false);
  });

  it('suppresses tracking after an explicit opt-out', () => {
    optOut();

    expect(hasOptedOut({ win: NO_SIGNAL })).toBe(true);
    expect(hasOptedIn()).toBe(false);
  });

  it('resumes tracking after an explicit opt-in', () => {
    optOut();
    optIn();

    expect(hasOptedOut({ win: NO_SIGNAL })).toBe(false);
    expect(hasOptedIn()).toBe(true);
  });

  it('lets a browser signal outrank an explicit stored opt-in', () => {
    // The heart of the ported decision table. A visitor who clicked "accept" while
    // broadcasting GPC has given two contradictory answers, and the
    // regulator-recognised one is the browser's.
    optIn();

    expect(hasOptedIn()).toBe(true);
    expect(hasOptedOut({ win: GPC_ON })).toBe(true);
    expect(hasOptedOut({ win: DNT_ON })).toBe(true);
  });

  it('lets ignore_dnt reverse that precedence', () => {
    optIn();

    expect(hasOptedOut({ win: GPC_ON, ignoreDnt: true })).toBe(false);
    expect(hasOptedOut({ win: DNT_ON, ignoreDnt: true })).toBe(false);
  });

  it('keeps honouring a stored opt-out even when ignore_dnt is set', () => {
    // `ignore_dnt` disables *browser* signals only. If it also overrode an explicit
    // opt-out it would be a switch for ignoring consent altogether.
    optOut();

    expect(hasOptedOut({ win: NO_SIGNAL, ignoreDnt: true })).toBe(true);
  });

  it('distinguishes "never asked" from "opted in" for a banner', () => {
    expect(hasOptedIn()).toBe(false);
    optIn();
    expect(hasOptedIn()).toBe(true);
    clearOptInOut();
    expect(hasOptedIn()).toBe(false);
    expect(loadStoredConsent()).toBe(null);
  });
});

describe('the opt-in tracking callback', () => {
  beforeEach(() => {
    clearOptInOut();
    resetConsentNotices();
  });

  it('fires on opt-in', () => {
    const track = vi.fn();
    optIn({ track });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('never fires on opt-out', () => {
    // Emitting an event to record an opt-out would be the one thing the visitor
    // just asked us not to do. This is Mixpanel's behaviour and it is correct.
    const track = vi.fn();
    optOut();
    expect(track).not.toHaveBeenCalled();
  });

  it('persists the opt-in even when the callback throws', () => {
    const track = vi.fn(() => {
      throw new Error('ingest down');
    });

    expect(() => optIn({ track })).not.toThrow();
    expect(hasOptedIn()).toBe(true);
  });
});

describe('diagnostic notices', () => {
  beforeEach(() => {
    clearOptInOut();
    resetConsentNotices();
  });

  it('names GPC specifically, so a customer can act on it', () => {
    const onNotice = vi.fn();
    hasOptedOut({ win: GPC_ON, onNotice });

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0]).toContain('Global Privacy Control');
    expect(onNotice.mock.calls[0][0]).toContain('ignore_dnt');
  });

  it('names DNT specifically', () => {
    const onNotice = vi.fn();
    hasOptedOut({ win: DNT_ON, onNotice });

    expect(onNotice.mock.calls[0][0]).toContain('Do Not Track');
  });

  it('names both when both are set', () => {
    const onNotice = vi.fn();
    hasOptedOut({
      win: {
        navigator: { doNotTrack: '1', globalPrivacyControl: true },
      } as never,
      onNotice,
    });

    expect(onNotice.mock.calls[0][0]).toContain(
      'Global Privacy Control and Do Not Track',
    );
  });

  it('warns once per page, not once per event', () => {
    // `hasOptedOut` is reachable from `isUserOptIn()`, which runs on every event.
    // Mixpanel warns per call; at our volumes that is thousands of identical
    // console lines and real time spent in the host page's console.
    const onNotice = vi.fn();
    for (let i = 0; i < 50; i++) {
      hasOptedOut({ win: DNT_ON, onNotice });
    }

    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('warns once for a stored opt-out too', () => {
    const onNotice = vi.fn();
    optOut();

    hasOptedOut({ win: NO_SIGNAL, onNotice });
    hasOptedOut({ win: NO_SIGNAL, onNotice });

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0]).toContain('opted out');
  });

  it('emits no notice when tracking is permitted', () => {
    const onNotice = vi.fn();
    hasOptedOut({ win: NO_SIGNAL, onNotice });

    expect(onNotice).not.toHaveBeenCalled();
  });

  it('re-arms the opt-out notice after an opt-in', () => {
    const onNotice = vi.fn();
    optOut();
    hasOptedOut({ win: NO_SIGNAL, onNotice });
    optIn();
    optOut();
    hasOptedOut({ win: NO_SIGNAL, onNotice });

    expect(onNotice).toHaveBeenCalledTimes(2);
  });
});

describe('consent reads that throw', () => {
  beforeEach(() => {
    resetConsentNotices();
  });

  it('fails open rather than inferring an opt-out from a broken store', () => {
    // A storage read that throws is an environment fault, not a privacy decision.
    // Inferring an opt-out from it would silently zero a customer's data on a
    // browser quirk — so this matches Mixpanel's `_addOptOutCheck`, which
    // continues on failure.
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
      set() {
        throw new Error('SecurityError');
      },
    });
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(hasOptedOut({ win: NO_SIGNAL })).toBe(false);
    expect(hasOptedIn()).toBe(false);

    getItem.mockRestore();
    delete (document as unknown as { cookie?: unknown }).cookie;
    if (descriptor) {
      Object.defineProperty(Document.prototype, 'cookie', descriptor);
    }
  });

  it('never throws out of optOut, even with every store dead', () => {
    // The hard rule: this runs inside the host page's consent-banner click handler.
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
      set() {
        throw new Error('SecurityError');
      },
    });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(() => optOut()).not.toThrow();
    expect(() => optIn()).not.toThrow();
    expect(() => clearOptInOut()).not.toThrow();

    setItem.mockRestore();
    removeItem.mockRestore();
    delete (document as unknown as { cookie?: unknown }).cookie;
    if (descriptor) {
      Object.defineProperty(Document.prototype, 'cookie', descriptor);
    }
  });
});
