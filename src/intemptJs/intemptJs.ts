import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts';
import {
  ConsentParams,
  FlagContext,
  FlagDetail,
  FlagReason,
  GroupParams,
  IdentifyParams,
  IntemptConfig,
  ProductParams,
  RecommendationParams,
  RecordParams,
  TrackParams,
} from './types/intemptJs.types.ts';
import { IntemptJsGuard } from './guards/intemptJs.guard.ts';
import { IdentifyModel } from './models/identify.model.ts';
import { GroupModel } from './models/group.model.ts';
import { TrackModel } from './models/track.model.ts';
import { RecordModel } from './models/record.model.ts';
import { detectDevice, dispatchIntemptEvent } from '../shared/shared.utils.ts';
import { localStorageCache } from '../shared/storageHandler.ts';
import { ConsentModel } from './models/consent.model.ts';
import { ChoicesModule } from './modules/choices/choices.module.ts';
import { ProductModel } from './models/product.model.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from './types/constants.types.ts';
import { EnvConfig } from '../shared/envConfig.ts';
import { SDK_VERSION } from '../shared/version.ts';
import { resolveIngestBaseUrl } from '../shared/privacy/dataResidency.ts';
import { clearOptInOut, hasOptedIn } from '../shared/privacy/gdpr.ts';
import { configureLogger, createLogger } from '../shared/logger/logger.ts';
import { MetricsSnapshot } from '../shared/logger/metrics.ts';

const log = createLogger('Intempt');

export class IntemptJs extends IntemptJsGuard {
  /** Build-time SDK version. Part of the public contract — see src/shared/version.ts */
  static readonly VERSION: string = SDK_VERSION;
  /** Instance mirror of {@link IntemptJs.VERSION}, for `window.intempt.VERSION`. */
  readonly VERSION: string = SDK_VERSION;

  /**
   * Ingest base URL. `config.apiHost` wins over the build-time default so a
   * data-residency customer can name their own regional endpoint — see
   * `resolveIngestBaseUrl` for why there is no `region` shorthand. Assigned in the
   * constructor because it depends on the config.
   */
  private readonly _api: string;
  private readonly _autoTracker!: AutoTrackerModule;
  private readonly _choices!: ChoicesModule;
  private readonly _config: IntemptConfig;

  constructor(config: IntemptConfig) {
    super();
    this._config = { ...config };

    // Logger first, before validation, on purpose: `isValidConfig` throws on a
    // bad config, and a customer debugging that throw wants the SDK's own
    // diagnostics already switched on when it happens.
    configureLogger({
      debug: config.debug,
      level: config.logLevel,
      sink: config.onDiagnostic,
    });

    // Routed through the logger rather than a bare console.warn: the logger is
    // now the single gate for SDK diagnostics, and it is configured above.
    this._api = resolveIngestBaseUrl(
      config?.apiHost,
      EnvConfig.getApi(),
      (message) => {
        log.warn(message);
      },
    );

    // D-24: this was `if (!this.isValidConfig(config)) return;`, an unreachable
    // branch — `isValidConfig` only ever throws or returns literal `true`, so the
    // `return` could not run and a misconfigured `new IntemptJs()` has always
    // thrown rather than yielding a half-built instance. Calling it as a
    // statement says that: validation is a throwing precondition, not a test.
    // (Do NOT "fix" the old branch by guarding `optIn`/`optOut` against an
    // undefined `_autoTracker` — DEFECTS D-24 records why that premise was wrong.)
    // The same dead `if (!this.isXValid(...)) return;` shape remains at the five
    // public-method call sites; removing it there wants the guards' return type
    // changed to `void` so a future author cannot reintroduce the assumption, and
    // that belongs with the `any` sweep which rewrites these signatures anyway.
    this.isValidConfig(config);

    this._autoTracker = new AutoTrackerModule(this._config, this._api);

    this._autoTracker.init();

    this._choices = new ChoicesModule({
      ...config,
      profileId: this._autoTracker.getProfileId(),
      sessionId: this._autoTracker.getSessionId(),
    });

    void this._choices.init();
  }

  /**
   * Current state of the delivery pipeline: queue depth, flush latency, events
   * dropped by the queue cap, and circuit-breaker state.
   *
   * Readable from the browser console on a customer's own page, which is the
   * point — it answers "are my events arriving?" with numbers instead of a guess.
   * `null` when the batcher failed to initialise (the SDK then falls back to a
   * simple queue with no metrics of its own).
   */
  getDiagnostics(): MetricsSnapshot | null {
    return this._autoTracker ? this._autoTracker.getDiagnostics() : null;
  }

  /**
   * Allow tracking
   * @return void
   * */
  optIn() {
    this._autoTracker.doNotTrack = false;
  }

  /**
   * Disable tracking
   * @return void
   * */
  optOut() {
    this._autoTracker.doNotTrack = true;
  }

  /**
   * Check track availability
   * @return { boolean }
   * Default: true
   * */
  isUserOptIn(): boolean {
    return !this._autoTracker.doNotTrack;
  }

  /**
   * Has the visitor *explicitly* opted in?
   *
   * Not the inverse of {@link isUserOptIn}. A visitor who has never been asked is
   * neither opted in nor opted out, and `isUserOptIn()` reports `true` for them
   * because tracking-by-default is the SDK's documented behaviour. A consent
   * banner needs this third state to decide whether to show itself at all.
   * @return { boolean }
   * */
  hasExplicitlyOptedIn(): boolean {
    return hasOptedIn();
  }

  /**
   * Forget the visitor's stored consent decision, returning them to "never asked".
   *
   * For re-asking after a privacy-policy change: with an explicit answer on file,
   * a banner has nothing to ask about. Distinct from `optOut()`, which records a
   * refusal — this records nothing.
   *
   * The in-memory flag is reset to what a fresh page load would compute from the
   * now-empty store — which, since this SDK tracks by default, means tracking
   * resumes. Leaving a stale opt-out in memory instead would make the current tab
   * disagree with every other tab and with the next reload. Any browser DNT/GPC
   * signal still applies: clearing a *stored* decision cannot clear that.
   * @return void
   * */
  clearConsent(): void {
    clearOptInOut();
    if (this._autoTracker) {
      this._autoTracker.forgetConsentDecision();
    }
  }

  /**
   * The profileId/sessionId/pageId triplet every event carries. Re-read on
   * every call rather than cached, so a session rollover or page change is
   * reflected immediately instead of drifting on a long-lived SPA tab.
   */
  private _ids(): { profileId: string; sessionId: string; pageId: string } {
    return {
      profileId: this._autoTracker.getProfileId(),
      sessionId: this._autoTracker.getSessionId(),
      pageId: this._autoTracker.getPageId(),
    };
  }

  /**
   * Use for user identification;
   * Optional params { eventTitle: string, userAttributes: {[key:string]:any}, data: {[key:string]:any} }
   * @param { IdentifyParams } params
   * @required params { userId: string }
   * @return void
   *
   * */
  identify(params: IdentifyParams): void {
    if (!this.isUserOptIn()) return;
    if (!this.isIdentifyValid(params)) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new IdentifyModel({
      ...params,
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent('intempt:identify', {
      eventName: eventData._name,
    });

    dispatchIntemptEvent('intempt:event', { event: eventData });
  }

  group(params: GroupParams) {
    if (!this.isUserOptIn()) return;
    if (!this.isGroupValid(params)) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new GroupModel({
      ...params,
      profileId,
      sessionId,
      pageId,
    });
    dispatchIntemptEvent('intempt:group', {
      eventName: eventData._name,
    });
    dispatchIntemptEvent('intempt:event', { event: eventData });
  }

  track(params: TrackParams) {
    if (!this.isUserOptIn()) return;
    if (!this.isTrackValid(params)) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new TrackModel({
      ...params,
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent('intempt:track', {
      eventName: eventData._name,
    });
    dispatchIntemptEvent('intempt:event', { event: eventData });
  }

  record(params: RecordParams) {
    if (!this.isUserOptIn()) return;
    if (!this.isRecordValid(params)) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new RecordModel({
      ...params,
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent('intempt:record', {
      eventName: eventData._name,
    });
    dispatchIntemptEvent('intempt:event', { event: eventData });
  }

  /**
   * Use for consent validation
   * Optional params { email: string, message: string, category: string }
   * @param { ConsentParams } params
   * @required params { action: 'accept' | 'reject', validUntil: number }
   * @return void
   *
   * Deliberately NOT gated on `isUserOptIn()` (D-5). Every other public method
   * skips work while opted out because that work is *tracking* — this one is
   * *recording a consent decision*, which is an audit record a regulator can
   * ask for. `optOut()` then `consent({action:'reject'})` must still produce
   * that record; gating it on the opt-out flag would silently discard the very
   * evidence of the refusal, and the reverse call order would break
   * re-consent. The record survives regardless of tracking state; only its
   * own shape validation (`isConsentValid`) can stop it.
   * */
  consent(params: ConsentParams): void {
    if (!this.isConsentValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sourceId = this._config.sourceId;

    // D-16: `getPageId()` used to be read here and passed to `ConsentModel`,
    // which declares no `pageId` field — so it was silently discarded. The read
    // was not free: `PageTrackerModule.getId()` MINTS the page-session cookie
    // when none exists, and `consent()` is deliberately not gated on opt-out
    // (D-5), so an opted-out visitor rejecting consent was having a tracking
    // cookie written for them by the very call that refused tracking. Dropping
    // the read removes dead work and that write. Adding `pageId` to the consent
    // wire contract instead is an ingest question — see BACKEND.md.
    const eventData = new ConsentModel({
      ...params,
      profileId,
      sourceId,
    });

    dispatchIntemptEvent('intempt:consent', {
      eventName: eventData._name,
    });

    dispatchIntemptEvent('intempt:event', { event: eventData });
  }

  productAdd(params: ProductParams) {
    if (!this.isUserOptIn()) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_ADD,
      products: [params],
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name,
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData });
  }

  productOrdered(params: ProductParams[]) {
    if (!this.isUserOptIn()) return;

    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_ORDER,
      products: params,
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name,
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData });
  }

  productView(productId: string) {
    if (!this.isUserOptIn()) return;
    const { profileId, sessionId, pageId } = this._ids();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_VIEW,
      products: [{ productId } as ProductParams],
      profileId,
      sessionId,
      pageId,
    });
    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name,
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData });
  }

  logOut() {
    if (!this.isUserOptIn()) return;

    this._autoTracker.refresh();

    dispatchIntemptEvent('intempt:logOut', {
      eventName: 'Log Out',
    });
  }

  /**
   * The value assigned to this person for `key`, or `defaultValue` if the service did not answer.
   *
   * This is the CODE path, distinct from the visual-editor path the rest of this SDK serves. The
   * `ChoicesModule` fetches from `choose-web` and applies changes against the DOM without the
   * caller branching; `variation` reads `choose-api` and hands back a value the caller branches on.
   * Both are legitimate and they are not interchangeable — a React component gated on a flag needs
   * a branch, not a DOM mutation.
   *
   * `choose-web` is deliberately untouched by this addition, so the visual editor keeps working
   * exactly as it does today.
   *
   * Ask for a KEY, never a mode. Whether the key names an experiment, a personalization or a flag
   * is the platform's business: its serving query filters on channel and status and never on mode.
   *
   * Gated on `isUserOptIn()` like every other public method that talks to the platform — see
   * `_chooseOrEmpty`. An opted-out visitor gets `defaultValue` and no request is made.
   *
   * KNOWN LIMITATION, accepted deliberately: an unassigned key and an unreachable service are
   * indistinguishable here. `choose-api` answers `200 {"choices":[]}` for a person with no
   * assignment, and a transport failure also yields no choices, so both resolve to
   * `defaultValue`. That ambiguity is the objection recorded in
   * `intempt-swift/docs/SDK-API-CONTRACT.md` (decided 2026-08-15) against shipping this surface
   * at all. It is accepted rather than answered because the consequence is bounded: the caller
   * always receives the value they nominated, which is the behaviour a kill switch needs in both
   * cases. Telling the two apart needs a `reason` on the wire; when the serving contract carries
   * one, `_variationDetail` becomes public and the ambiguity goes away.
   */
  async variation<T>(
    key: string,
    context: FlagContext,
    defaultValue: T,
  ): Promise<T> {
    const detail = await this._variationDetail<T>(key, context, defaultValue);
    return detail.value;
  }

  /**
   * Internal. NOT part of the public surface, and deliberately so.
   *
   * It would return a `reason`, and the platform does not send one yet: a held-back person's
   * experience is absent from the evaluation response entirely rather than present with a cause.
   * So every reason here would read `off` -- including for someone who WAS targeted and did
   * receive the variant. That is not a missing answer, it is a wrong one, and a method whose
   * entire purpose is explaining why must not guess.
   *
   * `variation` uses it for the value, which is correct either way. It becomes public when the
   * serving contract carries a reason.
   */
  private async _variationDetail<T>(
    key: string,
    context: FlagContext,
    defaultValue: T,
  ): Promise<FlagDetail<T>> {
    if (typeof key !== 'string' || !key.trim()) {
      throw new TypeError('variation: key is required');
    }
    if (defaultValue === undefined) {
      // Required, not optional. A caller who omits it has no answer during an outage, and the
      // failure surfaces far from here as an undefined branch.
      throw new TypeError('variation: defaultValue is required');
    }

    const choices = await this._chooseOrEmpty(context, [key]);
    const choice = choices.find((c) => c?.name === key);
    if (!choice) return { value: defaultValue, reason: 'off' };

    return {
      value: (choice.body ?? defaultValue) as T,
      reason: (choice.reason as FlagReason) ?? 'off',
    };
  }

  /**
   * Every key assigned to this person, in one call.
   *
   * OPEN, owner: platform. `EXP-SERVE-003` says every evaluation reports an exposure. If that is
   * honoured server-side, one `allFlags` call on page load records an exposure for every
   * experiment the person is in — including ones the page never renders — which inflates the live
   * denominator of each. The other SDKs need the same answer: either a non-recording route or an
   * `exposure: false` flag on the request. Until there is one, prefer `variation` per key at the
   * point the value is actually used.
   *
   * Gated on `isUserOptIn()` via `_chooseOrEmpty`; an opted-out visitor gets `{}`.
   */
  async allFlags(context: FlagContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const choice of await this._chooseOrEmpty(context, undefined)) {
      if (typeof choice?.name === 'string' && choice.name)
        out[choice.name] = choice.body;
    }
    return out;
  }

  async boolVariation(
    key: string,
    context: FlagContext,
    defaultValue: boolean,
  ): Promise<boolean> {
    const value = await this.variation<unknown>(key, context, defaultValue);
    // A served value of the wrong type is a misconfiguration, not something to coerce:
    // Boolean('false') is true, and a silent coercion is indistinguishable from a real answer.
    return typeof value === 'boolean' ? value : defaultValue;
  }

  async stringVariation(
    key: string,
    context: FlagContext,
    defaultValue: string,
  ): Promise<string> {
    const value = await this.variation<unknown>(key, context, defaultValue);
    return typeof value === 'string' ? value : defaultValue;
  }

  async numberVariation(
    key: string,
    context: FlagContext,
    defaultValue: number,
  ): Promise<number> {
    const value = await this.variation<unknown>(key, context, defaultValue);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : defaultValue;
  }

  /**
   * Resolves immediately.
   *
   * Present so the cross-SDK surface is the same everywhere, and so a caller porting from an SDK
   * that polls a local flag store does not have to remove the call. Evaluation is remote: each
   * `variation` is a request, so there is no local state to wait for.
   *
   * `timeoutMs` is ACCEPTED AND IGNORED, on purpose: it exists so the ported call site compiles
   * unchanged. There is nothing to time out on, so no value of it can change the outcome. It is
   * not dropped from the signature because removing it would break exactly the callers this
   * method exists for.
   */
  async waitForInitialization(timeoutMs?: number): Promise<void> {
    void timeoutMs;
  }

  /**
   * A transport failure yields no choices rather than throwing.
   *
   * This is the entire reason `defaultValue` is required: a network failure, a 5xx or a timeout
   * must resolve to the value the caller chose. A flag SDK that throws when the service is
   * unreachable takes the page down with it, which is the opposite of what a kill switch is for.
   *
   * THE ONE PLACE the flag surface talks to the platform, which is why the opt-out gate lives
   * here rather than repeated in five methods.
   *
   * AUTH, UNRESOLVED — owner: Sid (decision D4). This authenticates from the browser with the
   * public `writeKey`, the same credential `choose-web` uses. `EXP-SERVE-004` (Critical) requires
   * the SDK-surface evaluation endpoint to take a SERVER credential while the browser path stays
   * on the public key. If that lands as written, every `variation()` call already shipped in a
   * customer's page starts returning `defaultValue` behind a 401 — silently, because a non-2xx is
   * absorbed here by design. Either `choose-api` keeps accepting the public key from a browser
   * origin, or this surface needs a browser-specific route. Not settled in this PR.
   */
  private async _chooseOrEmpty(
    context: FlagContext,
    names: string[] | undefined,
  ): Promise<
    Array<{ name?: string; group?: unknown; body?: unknown; reason?: unknown }>
  > {
    // An evaluation reports an exposure (`EXP-SERVE-003`), and this request carries the
    // visitor's `profileId` and `userId`. Both are tracking, so an opted-out visitor must
    // produce no request at all — not merely a discarded response. Every caller of this method
    // already has a caller-nominated default to fall back to.
    if (!this.isUserOptIn()) return [];

    const { organization, sourceId, project, writeKey } = this._config;

    const identification: Record<string, unknown> = { sourceId };
    // The profile id the SDK already holds, unless the caller supplied one. It is the value that
    // survives sign-in, so deriving on it keeps a visitor's assignment stable across the moment
    // they log in.
    const profileId = context?.profileId ?? this._autoTracker.getProfileId();
    if (profileId) identification.profileId = profileId;
    if (context?.userId) identification.userId = context.userId;

    // The real device, not `all`. The serving query filters on it
    // (`and (device is null or device = 'ALL' or device = '<DEVICE>')`), so `all` matched every
    // row and a mobile-only experience evaluated true for a desktop visitor here while
    // `choose-web` correctly withheld it. Same helper as `choose-web`, so the two channels
    // cannot drift.
    const body: Record<string, unknown> = {
      identification,
      device: detectDevice(),
    };
    if (names) body.names = names;

    try {
      // Inside the try with the request: this method's contract is that transport-class
      // failures resolve rather than throw, and `split`/`btoa` are part of building the
      // request. `btoa` throws `InvalidCharacterError` on a non-Latin1 key, which outside the
      // try would escape past a caller who was promised a default.
      const [username, password] = String(writeKey ?? '').split('.');
      const url = `${this._api}/${organization}/projects/${project}/optimization/choose-api`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        },
        body: JSON.stringify(body),
      });
      if (!response?.ok) return [];
      const parsed = await response.json();
      return Array.isArray(parsed?.choices) ? parsed.choices : [];
    } catch {
      return [];
    }
  }

  async recommendation(params: RecommendationParams) {
    if (!this.isUserOptIn()) return null;

    const { organization, sourceId, project, writeKey } = this._config;
    const { id, quantity, fields } = params;
    const url = `${this._api}/${organization}/projects/${project}/feeds/${id}/data`;
    const [username, password] = writeKey.split('.');
    const profileId = this._autoTracker.getProfileId();
    const productId = localStorageCache.get('productId');
    const body = {
      profileId,
      sourceId,
      limit: quantity,
      fields,
      productId: productId?.toString(),
    };

    const encodedCredentials = btoa(`${username}:${password}`);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ ...body }),
        keepalive: true,
      });
      return response?.json();
    } catch {
      // Swallowed deliberately: a failed consent POST must not throw into the
      // customer's own click handler. The binding is omitted rather than named
      // and ignored, so the lint ratchet stays at zero warnings for this file.
      return null;
    }
  }
}
