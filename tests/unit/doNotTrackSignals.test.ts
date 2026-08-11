import { describe, expect, it } from 'vitest';
import {
  detectDoNotTrackSignals,
  shouldSuppressForBrowserSignal,
} from '../../src/shared/privacy/doNotTrackSignals.ts';

/**
 * DNT and GPC are read from an injected window rather than by mutating the real
 * `navigator`. jsdom's `navigator.doNotTrack` is a getter on a prototype shared by
 * the whole file, so mutating it leaks between tests in ways that are miserable to
 * debug — and the injection point exists in the source for exactly this reason
 * (Mixpanel's original carries the same `options.window` seam).
 */
function fakeWindow(
  navigatorProps: Record<string, unknown>,
  windowProps: Record<string, unknown> = {},
) {
  return { navigator: navigatorProps, ...windowProps } as unknown as Window &
    typeof globalThis;
}

describe('DNT detection', () => {
  it('reports no signal when neither flag is set', () => {
    expect(detectDoNotTrackSignals(fakeWindow({}))).toEqual({
      dnt: false,
      gpc: false,
      anySignal: false,
    });
  });

  it.each([
    ['1', 'the string form Firefox actually sends'],
    [1, 'the numeric form'],
    [true, 'the boolean form'],
    ['yes', 'the legacy IE form'],
  ])('treats navigator.doNotTrack = %o as on (%s)', (value, _why) => {
    expect(detectDoNotTrackSignals(fakeWindow({ doNotTrack: value })).dnt).toBe(
      true,
    );
  });

  it.each([
    ['0', 'explicitly opted in to tracking'],
    ['unspecified', 'the value Chrome reports when the user has not chosen'],
    [null, 'absent'],
    [undefined, 'absent'],
    ['no', 'not an accepted truthy form'],
  ])('treats navigator.doNotTrack = %o as off (%s)', (value, _why) => {
    expect(detectDoNotTrackSignals(fakeWindow({ doNotTrack: value })).dnt).toBe(
      false,
    );
  });

  it('reads the legacy navigator.msDoNotTrack', () => {
    expect(detectDoNotTrackSignals(fakeWindow({ msDoNotTrack: '1' })).dnt).toBe(
      true,
    );
  });

  it('reads window.doNotTrack, where old Safari put it', () => {
    expect(
      detectDoNotTrackSignals(fakeWindow({}, { doNotTrack: '1' })).dnt,
    ).toBe(true);
  });
});

describe('GPC detection', () => {
  it('reports GPC when navigator.globalPrivacyControl is true', () => {
    const signals = detectDoNotTrackSignals(
      fakeWindow({ globalPrivacyControl: true }),
    );

    expect(signals.gpc).toBe(true);
    // GPC is reported separately from DNT so a diagnostic can name which one
    // fired — "we stopped because of GPC" and "…because of DNT" are very
    // different conversations with a customer.
    expect(signals.dnt).toBe(false);
    expect(signals.anySignal).toBe(true);
  });

  it.each([false, undefined, null, 0])(
    'reports no GPC for globalPrivacyControl = %o',
    (value) => {
      expect(
        detectDoNotTrackSignals(fakeWindow({ globalPrivacyControl: value }))
          .gpc,
      ).toBe(false);
    },
  );

  it('does not accept the string "1" for GPC', () => {
    // GPC is specified as a boolean. Accepting a string would be inventing a wire
    // format no browser sends.
    expect(
      detectDoNotTrackSignals(fakeWindow({ globalPrivacyControl: '1' })).gpc,
    ).toBe(false);
  });

  it('reports both when both are set', () => {
    const signals = detectDoNotTrackSignals(
      fakeWindow({ doNotTrack: '1', globalPrivacyControl: true }),
    );

    expect(signals).toEqual({ dnt: true, gpc: true, anySignal: true });
  });
});

describe('signal detection never throws', () => {
  it('reports no signal when there is no window at all', () => {
    expect(detectDoNotTrackSignals(undefined as never)).toBeDefined();
  });

  it('reports no signal when navigator is missing', () => {
    expect(
      detectDoNotTrackSignals({} as Window & typeof globalThis).anySignal,
    ).toBe(false);
  });

  it('reports no signal when a property read throws', () => {
    // A hostile or exotic embedding can make even a property read throw. Failing
    // open preserves today's behaviour rather than zeroing a customer's data on an
    // environment quirk.
    const hostile = {
      get navigator(): never {
        throw new Error('blocked');
      },
    } as unknown as Window & typeof globalThis;

    expect(() => detectDoNotTrackSignals(hostile)).not.toThrow();
    expect(detectDoNotTrackSignals(hostile).anySignal).toBe(false);
  });
});

describe('ignore_dnt', () => {
  it('suppresses tracking when DNT is on and ignore_dnt is unset', () => {
    expect(
      shouldSuppressForBrowserSignal(
        undefined,
        fakeWindow({ doNotTrack: '1' }),
      ),
    ).toBe(true);
  });

  it('suppresses tracking when GPC is on and ignore_dnt is unset', () => {
    expect(
      shouldSuppressForBrowserSignal(
        undefined,
        fakeWindow({ globalPrivacyControl: true }),
      ),
    ).toBe(true);
  });

  it('does not suppress when neither signal is present', () => {
    expect(shouldSuppressForBrowserSignal(undefined, fakeWindow({}))).toBe(
      false,
    );
    expect(shouldSuppressForBrowserSignal(false, fakeWindow({}))).toBe(false);
  });

  it('overrides DNT when ignore_dnt is true', () => {
    expect(
      shouldSuppressForBrowserSignal(true, fakeWindow({ doNotTrack: '1' })),
    ).toBe(false);
  });

  it('overrides GPC as well as DNT — one switch covers both', () => {
    // Stated as an assertion because it is the surprising half of the option: a
    // customer setting `ignore_dnt` also takes on the CCPA obligation for GPC.
    expect(
      shouldSuppressForBrowserSignal(
        true,
        fakeWindow({ globalPrivacyControl: true }),
      ),
    ).toBe(false);
    expect(
      shouldSuppressForBrowserSignal(
        true,
        fakeWindow({ doNotTrack: '1', globalPrivacyControl: true }),
      ),
    ).toBe(false);
  });
});
