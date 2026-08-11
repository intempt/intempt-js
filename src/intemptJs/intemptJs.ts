import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts'
import {
  AliasParams,
  ConsentParams,
  GroupParams,
  IdentifyParams, IntemptConfig, ProductParams, RecommendationParams,
  RecordParams,
  TrackParams,
} from './types/intemptJs.types.ts';
import { IntemptJsGuard } from './guards/intemptJs.guard.ts';
import { IdentifyModel } from './models/identify.model.ts';
import { GroupModel } from './models/group.model.ts';
import { TrackModel } from './models/track.model.ts';
import { RecordModel } from './models/record.model.ts';
import { AliasModel } from './models/alias.model.ts';
import { dispatchIntemptEvent } from '../shared/shared.utils.ts';
import { localStorageCache } from '../shared/storageHandler.ts';
import { ConsentModel } from './models/consent.model.ts';
import { ChoicesModule } from './modules/choices/choices.module.ts';
import { ProductModel } from './models/product.model.ts';
import { IntemptEventListenerName, IntemptEventName } from './types/constants.types.ts';
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
  private readonly _autoTracker!:AutoTrackerModule;
  private readonly _choices!:ChoicesModule;
  private readonly _config:IntemptConfig;


  constructor(config:IntemptConfig) {
    super();
    this._config = { ...config};

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
    this._api = resolveIngestBaseUrl(config?.apiHost, EnvConfig.getApi(), (message) => {
      log.warn(message);
    });

    if(!this.isValidConfig(config)) return;

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
  optIn(){
    this._autoTracker.doNotTrack = false;
  }

  /**
   * Disable tracking
   * @return void
   * */
  optOut(){
    this._autoTracker.doNotTrack = true;
  }

  /**
   * Check track availability
   * @return { boolean }
   * Default: true
   * */
  isUserOptIn(): boolean{
    return !this._autoTracker.doNotTrack
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
  hasExplicitlyOptedIn(): boolean{
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
  clearConsent(): void{
    clearOptInOut();
    if (this._autoTracker) {
      this._autoTracker.forgetConsentDecision();
    }
  }

  /**
   * Use for user identification;
   * Optional params { eventTitle: string, userAttributes: {[key:string]:any}, data: {[key:string]:any} }
   * @param { IdentifyParams } params
   * @required params { userId: string }
   * @return void
   *
   * */
  identify(params:IdentifyParams):void{
    if (!this.isUserOptIn()) return;
    if (!this.isIdentifyValid(params)) return;


    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new IdentifyModel({
      ...params,
      profileId,
      sessionId,
      pageId
    })

    dispatchIntemptEvent('intempt:identify', {
      eventName: eventData._name
    });


    dispatchIntemptEvent('intempt:event', { event: eventData});
  }

  group(params:GroupParams){
    if (!this.isUserOptIn()) return;
    if (!this.isGroupValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new GroupModel({
      ...params,
      profileId,
      sessionId,
      pageId
    })
    dispatchIntemptEvent('intempt:group', {
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
    
  }


  track(params:TrackParams){
    if (!this.isUserOptIn()) return;
    if (!this.isTrackValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new TrackModel({
      ...params,
      profileId,
      sessionId,
      pageId
    })


    dispatchIntemptEvent('intempt:track',{
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
  }


  record(params:RecordParams){
    if (!this.isUserOptIn()) return;
    if (!this.isRecordValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new RecordModel({
      ...params,
      profileId,
      sessionId,
      pageId
    })

    dispatchIntemptEvent('intempt:record', {
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
  }


  alias(params:AliasParams){
    if (!this.isUserOptIn()) return;
    if (!this.isAliasValid(params)) return;

    const profileId = this._autoTracker.getProfileId();

    const eventData = new AliasModel({
      ...params,
      profileId,
    })


    dispatchIntemptEvent('intempt:alias', {
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
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
  consent(params: ConsentParams):void {
    if (!this.isConsentValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sourceId = this._config.sourceId;
    const pageId = this._autoTracker.getPageId();

    const eventData = new ConsentModel({
      ...params,
      profileId,
      sourceId,
      pageId
    })

    dispatchIntemptEvent('intempt:consent', {
      eventName: eventData._name
    });

    dispatchIntemptEvent('intempt:event', { event: eventData});
  }

  productAdd(params: ProductParams){
    if (!this.isUserOptIn()) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_ADD,
      products: [ params ],
      profileId,
      sessionId,
      pageId,
    })

    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData});
  }

  productOrdered(params: ProductParams[]){
    if (!this.isUserOptIn()) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_ORDER,
      products: params,
      profileId,
      sessionId,
      pageId,
    })

    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData});

  }

  productView(productId: string){
    if (!this.isUserOptIn()) return;
    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();
    const pageId = this._autoTracker.getPageId();

    const eventData = new ProductModel({
      eventTitle: IntemptEventName.PRODUCT_VIEW,
      products: [{ productId } as ProductParams],
      profileId,
      sessionId,
      pageId,
    })
    dispatchIntemptEvent(IntemptEventListenerName.PRODUCT, {
      eventName: eventData._name
    });
    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData});

  }

  logOut(){
    if (!this.isUserOptIn()) return;

    this._autoTracker.refresh();

    dispatchIntemptEvent('intempt:logOut', {
      eventName: 'Log Out'
    });
  }

  async recommendation (params:RecommendationParams){
    if (!this.isUserOptIn()) return null;

    const {organization, sourceId, project, writeKey} = this._config;
    const {id, quantity, fields} = params
    const url = `${this._api}/${organization}/projects/${project}/feeds/${id}/data`;
    const [ username, password ] = writeKey.split('.');
    const profileId = this._autoTracker.getProfileId();
    const productId = localStorageCache.get('productId');
    const body = {
      profileId,
      sourceId,
      limit: quantity,
      fields,
      productId: productId?.toString(),
    }

    const encodedCredentials = btoa(`${username}:${password}`);
    try{
      const response =  await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({...body }),
        keepalive: true
      });
      return response?.json();
    }
    catch(error){
      return null
    }

  }
}
