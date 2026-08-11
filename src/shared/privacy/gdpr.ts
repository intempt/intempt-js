/*
 * Copyright Mixpanel, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Derived from mixpanel-js `src/gdpr-utils.js` (v2.81.0). See NOTICE.
 */

import { EnvConfig } from '../envConfig.ts';
import {
  clearStoredConsent,
  loadStoredConsent,
  persistDoNotTrack,
} from '../consentState.ts';
import { detectDoNotTrackSignals } from './doNotTrackSignals.ts';

/**
 * GDPR / CCPA opt-in-out surface, ported from Mixpanel's `gdpr-utils.js`.
 *
 * The value taken from that file is its **decision table**, not its plumbing:
 * which signals count as an opt-out, that a browser DNT flag outranks a stored
 * opt-in, that opting in is the only action worth emitting an event for, and that
 * the whole check has to be wrapped so a failure to *read* consent never breaks
 * the caller. Those are the parts that are easy to get subtly wrong and expensive
 * to get wrong.
 *
 * ## Deliberate divergences from the original
 *
 *  - **No `persistenceType` option.** Mixpanel makes the caller pick cookie *or*
 *    localStorage. We always write both (see `consentState.ts`), which is
 *    strictly more robust: a visitor blocking one store still keeps their
 *    decision, and the cookie is what makes consent cross-subdomain at all. An
 *    option to *disable* the cookie would be an option to reintroduce D15.
 *  - **No `token` / per-source keying.** Mixpanel keys consent by project token
 *    because one page can host several Mixpanel projects. Consent is a property
 *    of the *visitor*, not of the source collecting data about them, and this SDK
 *    initialises one instance per page — so a source-keyed store would let the
 *    same visitor be opted out of one of our sources and tracked by another,
 *    which is not a defensible reading of "I do not consent".
 *  - **The DNT warning fires once per page, not once per call.** Mixpanel's
 *    `hasOptedOut` warns on every invocation. Ours is reached from
 *    `isUserOptIn()`, which runs on **every event**, so warning per call would
 *    emit thousands of identical console lines and cost real time in the host
 *    page's console.
 *  - **`addOptOutCheck*` is not ported.** Those three functions decorate every
 *    public method with a consent check. Every public method in `intemptJs.ts`
 *    already opens with `if (!this.isUserOptIn()) return;`, so the decorator
 *    would add an indirection layer with no new behaviour — and an unused
 *    abstraction in consent code is worse than none, because the next reader
 *    cannot tell which of the two mechanisms is authoritative.
 */

export type ConsentQueryOptions = {
  /**
   * Ignore browser DNT **and GPC**. For customers running their own consent
   * management platform, whose explicit logged consent is better evidence than a
   * browser default. Setting it moves the CCPA obligation to the customer.
   */
  ignoreDnt?: boolean;
  /** Diagnostic sink. Defaults to a non-production `console.warn`. */
  onNotice?: (message: string) => void;
  /** Injectable window, for tests. */
  win?: Window & typeof globalThis;
};

/**
 * Per-page latch for the notices below. Module-level rather than per-instance
 * because the console is a page-level resource — two SDK instances warning about
 * the same browser flag is still noise.
 */
let dntNoticeEmitted = false;
let optOutNoticeEmitted = false;

/** Reset the once-per-page notice latches. Exists for tests. */
export function resetConsentNotices(): void {
  dntNoticeEmitted = false;
  optOutNoticeEmitted = false;
}

function notice(message: string, sink?: (message: string) => void): void {
  try {
    if (sink) {
      sink(message);
      return;
    }
    // Gated on environment, matching every other diagnostic in the SDK. A
    // customer's production console is not ours to write to.
    if (!EnvConfig.isProduction()) {
      // eslint-disable-next-line no-console -- default sink, gated above
      console.warn(message);
    }
  } catch {
    // A diagnostic must never be the reason a consent check fails.
  }
}

/**
 * Whether tracking is suppressed for this visitor.
 *
 * Order is the whole point: **a browser signal outranks a stored opt-in.** A
 * visitor who clicked "accept" on a banner while their browser broadcasts GPC has
 * given two contradictory answers, and the regulator-recognised one is the
 * browser's. `ignoreDnt` is the only way to reverse that precedence, and it is
 * the customer's call to make, not ours.
 */
export function hasOptedOut(options: ConsentQueryOptions = {}): boolean {
  try {
    if (!options.ignoreDnt) {
      const signals = detectDoNotTrackSignals(options.win);
      if (signals.anySignal) {
        if (!dntNoticeEmitted) {
          dntNoticeEmitted = true;
          const which =
            signals.gpc && signals.dnt
              ? 'Global Privacy Control and Do Not Track are'
              : signals.gpc
                ? 'Global Privacy Control is'
                : 'Do Not Track is';
          notice(
            `[Intempt] ${which} enabled in this browser, so no data will be sent. ` +
              'To ignore browser privacy signals — for example because you operate ' +
              'your own consent gate — initialise Intempt with `ignore_dnt: true`.',
            options.onNotice,
          );
        }
        return true;
      }
    }

    const optedOut = loadStoredConsent() === true;

    if (optedOut && !optOutNoticeEmitted) {
      optOutNoticeEmitted = true;
      notice(
        '[Intempt] This visitor has opted out of tracking, so no data will be sent.',
        options.onNotice,
      );
    }

    return optedOut;
  } catch {
    // Mixpanel's `_addOptOutCheck` wraps the equivalent read in a try/catch and
    // continues on failure, and that default is right: a storage read that throws
    // is an environment fault, not a privacy decision, and inferring an opt-out
    // from it would silently zero a customer's data on a browser quirk.
    return false;
  }
}

/**
 * Whether the visitor has *explicitly* opted in.
 *
 * Not the negation of {@link hasOptedOut}: a visitor who has never been asked is
 * neither opted in nor opted out. A consent banner needs that third state to know
 * whether to show itself.
 */
export function hasOptedIn(): boolean {
  try {
    return loadStoredConsent() === false;
  } catch {
    return false;
  }
}

export type OptInOptions = {
  /** Called after an opt-**in** only, to record the consent action as an event. */
  track?: () => void;
};

/**
 * Record an explicit opt-in.
 *
 * The tracking callback fires only on opt-in, matching the original: emitting an
 * event to record an opt-*out* would be the one thing the visitor just asked us
 * not to do.
 */
export function optIn(options: OptInOptions = {}): void {
  persistDoNotTrack(false);
  optOutNoticeEmitted = false;

  try {
    options.track?.();
  } catch {
    // The consent decision is already persisted. A failing analytics callback
    // must not make the caller believe the opt-in did not take.
  }
}

/** Record an explicit opt-out. Never throws — see `consentState.ts`. */
export function optOut(): void {
  persistDoNotTrack(true);
}

/**
 * Erase the stored decision, returning the visitor to "never asked".
 *
 * The case this exists for: a customer changing their privacy policy has to
 * re-ask, and cannot do that while an explicit answer is on file.
 */
export function clearOptInOut(): void {
  clearStoredConsent();
  resetConsentNotices();
}
