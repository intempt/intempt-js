import { IntemptConfig } from '../../types/intemptJs.types.ts';
import {
  loadDoNotTrack,
  persistDoNotTrack,
} from '../../../shared/consentState.ts';
import { shouldSuppressForBrowserSignal } from '../../../shared/privacy/doNotTrackSignals.ts';
import { hasOptedOut } from '../../../shared/privacy/gdpr.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { DeliveryFailure } from '../../../shared/queue/requestBatcher.ts';

const log = createLogger('AutoTracker');

// The batcher's flush interval (autoTracker.transport.ts): a kept record is
// retried no sooner than the next scheduled flush (ruling R4).
const KEPT_RETRY_MS = 5000;
// CONTRACT-R2 §S1: one 503/429 resend after Retry-After clamped to this range.
const MIN_RESEND_WAIT_MS = 1000;
const MAX_RESEND_WAIT_MS = 60 * 1000;
/** In memory only, so the cap bounds what an offline tab holds. */
const MAX_KEPT_RECORDS = 100;

type ConsentRecord = Record<string, unknown>;

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
 * wrapped in `{track:[...]}`: an audit record should not sit in a queue behind
 * analytics events. It follows the same send-once rules as events (rulings R2/R3,
 * 2026-11-13): one 503/429 resend after Retry-After, every other answered status
 * dropped, a record that never reached the server kept in memory for a retry,
 * and every lost record reported through `onDeliveryFailure`.
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

  /** Records whose send never reached the server, oldest first. */
  private readonly _kept: ConsentRecord[] = [];
  private _keptTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * POST a consent record. Never throws: a failure here must not propagate into a
   * consent banner's click handler. A failure is logged at error level and
   * reported through `onDeliveryFailure` instead.
   */
  async sendConsentRecord(data: ConsentRecord): Promise<void> {
    await this._deliver(data, false, false);
  }

  private async _deliver(
    data: ConsentRecord,
    resent: boolean,
    alreadyReported: boolean,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this._post(data);
    } catch (error) {
      // fetch cannot tell a refused connection from one lost after the write;
      // a rejection is treated as never reached, like the batcher's transport.
      log.error('consent record never reached the server, kept', error);
      this._keep(data, alreadyReported);
      return;
    }
    if (response.ok) return;

    const status = response.status;
    const seconds = parseInt(response.headers?.get?.('Retry-After') ?? '', 10);
    const retryAfter = Number.isFinite(seconds) ? seconds : undefined;
    if ((status === 503 || status === 429) && !resent) {
      log.error(`consent record got ${status}, one resend`);
      const waitMS = Math.min(
        MAX_RESEND_WAIT_MS,
        Math.max(MIN_RESEND_WAIT_MS, (retryAfter ?? 0) * 1000),
      );
      setTimeout(() => void this._deliver(data, true, alreadyReported), waitMS);
      return;
    }
    log.error(`consent record dropped, status ${status}`);
    this._report({
      kind: 'terminal',
      status,
      terminal: true,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }

  private _keep(data: ConsentRecord, alreadyReported: boolean): void {
    if (!alreadyReported) this._report({ kind: 'transport', terminal: false });
    this._kept.push(data);
    while (this._kept.length > MAX_KEPT_RECORDS) {
      this._kept.shift();
      log.error('consent record dropped, kept-record cap reached');
      this._report({ kind: 'dropped', terminal: true });
    }
    if (this._keptTimer === null) {
      this._keptTimer = setTimeout(() => {
        this._keptTimer = null;
        const due = this._kept.splice(0, this._kept.length);
        for (const record of due) void this._deliver(record, false, true);
      }, KEPT_RETRY_MS);
    }
  }

  private _report(
    failure: Omit<DeliveryFailure, 'eventCount' | 'eventIds'>,
  ): void {
    const listener = this._config.onDeliveryFailure;
    if (!listener) return;
    try {
      // A consent record carries no eventId.
      listener({ ...failure, eventCount: 1, eventIds: [] });
    } catch (error) {
      log.error('onDeliveryFailure listener threw', error);
    }
  }

  /** One POST; rejects only when no HTTP answer came back. */
  private _post(data: ConsentRecord): Promise<Response> {
    const { organization, project, writeKey } = this._config;

    const url = `${this._api}/${organization}/projects/${project}/consents/data`;

    const [username, password] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${encodedCredentials}`,
      },
      body: JSON.stringify({ ...data }),
      keepalive: true,
    });
  }
}
