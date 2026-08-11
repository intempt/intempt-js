/**
 * Browser-level "do not track me" signals: DNT and GPC.
 *
 * Derived from mixpanel-js `src/gdpr-utils.js` `_hasDoNotTrackFlagOn`
 * (Apache-2.0 — see NOTICE). The three-property check and the accepted-truthy
 * value set (`true`, `1`, `'1'`, `'yes'`) are theirs; GPC, the TypeScript, and
 * the never-throw posture are ours.
 *
 * ---
 *
 * The two signals are not interchangeable, and the difference matters when
 * deciding what to honour:
 *
 *  - **DNT** (`navigator.doNotTrack`) is a *preference*. It was never ratified,
 *    Safari removed it in 2019 precisely because it had become a fingerprinting
 *    vector, and Chrome leaves it off by default. In practice it is set by a
 *    minority of Firefox users who went looking for it.
 *  - **GPC** (`navigator.globalPrivacyControl`) is a *legal* opt-out signal. It
 *    is recognised under CCPA/CPRA and the Colorado Privacy Act, which means
 *    ignoring it is not a product decision but a regulatory exposure. It is
 *    strictly more load-bearing than DNT.
 *
 * Both are read together here because a customer configures one escape hatch
 * (`ignore_dnt`) for both, but they are reported separately by
 * {@link detectDoNotTrackSignals} so a diagnostic can say *which* fired — "we
 * dropped your traffic because of GPC" and "…because of DNT" lead to very
 * different conversations with a customer.
 */

/** Values a browser may use to mean "on" across the three DNT properties. */
const DNT_ON_VALUES: ReadonlyArray<unknown> = [true, 1, '1', 'yes'];

export type DoNotTrackSignals = {
  /** `navigator.doNotTrack`, `navigator.msDoNotTrack`, or `window.doNotTrack`. */
  readonly dnt: boolean;
  /** `navigator.globalPrivacyControl`. */
  readonly gpc: boolean;
  /** True when either fired. Convenience for the common call site. */
  readonly anySignal: boolean;
};

const NO_SIGNALS: DoNotTrackSignals = { dnt: false, gpc: false, anySignal: false };

/**
 * Read DNT and GPC from the current browser.
 *
 * Never throws. Property access on `navigator` is safe in every browser, but
 * this runs on a code path that must not be able to break a host page's consent
 * banner, and a `window` shim in a test or an exotic embedding can make even a
 * property read throw. Absent-or-unreadable resolves to "no signal", which
 * preserves today's behaviour rather than silently dropping traffic on an
 * environment quirk.
 */
export function detectDoNotTrackSignals(win?: Window & typeof globalThis): DoNotTrackSignals {
  try {
    const target = win ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target) {
      return NO_SIGNALS;
    }

    const nav = (target.navigator ?? {}) as Navigator & {
      msDoNotTrack?: unknown;
      globalPrivacyControl?: unknown;
    };

    const candidates: unknown[] = [
      nav.doNotTrack,
      nav.msDoNotTrack,
      (target as unknown as { doNotTrack?: unknown }).doNotTrack,
    ];

    const dnt = candidates.some((value) => DNT_ON_VALUES.indexOf(value) !== -1);
    // GPC is specified as a boolean, so unlike DNT there is no string form to
    // accept. Accepting `'1'` here would be inventing a wire format.
    const gpc = nav.globalPrivacyControl === true;

    return { dnt, gpc, anySignal: dnt || gpc };
  } catch {
    return NO_SIGNALS;
  }
}

/**
 * Whether a browser-level signal should suppress tracking.
 *
 * `ignoreDnt` is the escape hatch for customers who run their own consent
 * management platform: a CMP that has already collected an explicit, logged
 * consent is better evidence of the visitor's wishes than a browser default,
 * and honouring both means the CMP's "yes" is silently overridden. It disables
 * **GPC as well as DNT** — which is deliberate and worth stating, because a
 * customer setting it takes on the CCPA obligation themselves.
 */
export function shouldSuppressForBrowserSignal(
  ignoreDnt?: boolean,
  win?: Window & typeof globalThis,
): boolean {
  if (ignoreDnt) {
    return false;
  }
  return detectDoNotTrackSignals(win).anySignal;
}
