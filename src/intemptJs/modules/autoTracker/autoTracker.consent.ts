import { IntemptConfig } from '../../types/intemptJs.types.ts';
import {
  loadDoNotTrack,
  persistDoNotTrack,
} from '../../../shared/consentState.ts';
import { shouldSuppressForBrowserSignal } from '../../../shared/privacy/doNotTrackSignals.ts';
import { hasOptedOut } from '../../../shared/privacy/gdpr.ts';
import { createLogger } from '../../../shared/logger/logger.ts';

const log = createLogger('AutoTracker');

/**
 * Owns the two questions "may this visitor be tracked?" and "how is a consent
 * decision recorded?" — the stored opt-out, the browser signal that outranks it,
 * and the POST to the `/consents/data` endpoint.
 *
 * Extracted from `autoTracker.module.ts` (the consent split). The reason to
 * separate this rather than leave it inline is that consent is the one area of the
 * SDK where the rules are legal rather than technical, and they are easy to break
 * with a plausible-looking edit: a browser signal must never be persisted, an
 * `optIn()` must not clear it, and a consent record must be sent even while the
 * visitor is opted out. Those three invariants now live in one file with the
 * reasoning attached, instead of being spread across a 500-line module.
 *
 * **Consent delivery deliberately does NOT go through the batcher.** It is a direct
 * `fetch` to a different endpoint with the record spread at the top level, not
 * wrapped in `{track:[...]}`, and it is not batched, retried or queued. That is
 * pre-existing behaviour, kept exactly: an audit record should not sit in a queue
 * behind analytics events.
 */
export class AutoTrackerConsent {
  private readonly _config: IntemptConfig;
  private readonly _api: string;

  private _doNotTrack: boolean = loadDoNotTrack();

  /**
   * DNT/GPC, read once at construction.
   *
   * Kept **separate from `_doNotTrack`** rather than folded into it, for two
   * reasons that are easy to get wrong:
   *
   *  1. A browser signal must never be *persisted*. Writing it into the stored
   *     consent would make a transient browser setting look like an explicit
   *     visitor decision, and it would then survive the visitor turning the
   *     setting back off.
   *  2. A browser signal outranks a stored opt-in (see `gdpr.ts`), so `optIn()`
   *     must not be able to clear it. Sharing one field would let it.
   *
   * Read once because neither flag changes during a page's life, and
   * `isUserOptIn()` is on the per-event hot path.
   */
  private readonly _browserSignalSuppressed: boolean;

  constructor(config: IntemptConfig, api: string) {
    this._config = config;
    this._api = api;

    this._browserSignalSuppressed = shouldSuppressForBrowserSignal(
      config.ignore_dnt,
    );

    // Called for its side effect: the one-per-page console notice naming *which*
    // signal stopped the data. That notice is the difference between a support
    // ticket and a silent outage, and it has to be emitted at init rather than
    // from the hot path.
    hasOptedOut({ ignoreDnt: config.ignore_dnt });
  }

  /**
   * Effective do-not-track state: the stored decision OR a browser signal.
   *
   * The getter reports the browser signal too, so `IntemptJs.isUserOptIn()` tells
   * a customer's own code the truth about whether events will be sent. Reporting
   * only the stored flag would have it answer `true` while the SDK silently
   * dropped everything.
   */
  get doNotTrack(): boolean {
    return this._doNotTrack || this._browserSignalSuppressed;
  }

  set doNotTrack(value: boolean) {
    // Only the explicit decision is stored and mutated. A browser signal is not
    // the visitor's stored consent and cannot be cleared by `optIn()` — see the
    // note on `_browserSignalSuppressed`.
    this._doNotTrack = value;
    persistDoNotTrack(value);
  }

  isUserOptIn(): boolean {
    return !this.doNotTrack;
  }

  /**
   * Drop the in-memory stored decision without writing one.
   *
   * Pairs with `IntemptJs.clearConsent()`, which has already emptied the store.
   * Assigns the *field* rather than going through the setter on purpose: calling
   * `doNotTrack = false` would persist an explicit opt-in and re-create exactly
   * the decision that was just cleared.
   */
  forgetConsentDecision(): void {
    this._doNotTrack = false;
  }

  /**
   * POST a consent record. Never throws: a failure here must not propagate into a
   * consent banner's click handler.
   */
  async sendConsentRecord(data: Record<string, unknown>): Promise<void> {
    const { organization, project, writeKey } = this._config;

    const url = `${this._api}/${organization}/projects/${project}/consents/data`;

    const [username, password] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ ...data }),
        keepalive: true,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
    } catch (error) {
      log.error('error sending track event data', error);
    }
  }
}
