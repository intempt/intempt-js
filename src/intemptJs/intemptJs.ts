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
import { setCookie } from '../shared/storageHandler.ts';
import { ConsentModel } from './models/consent.model.ts';
import { ChoicesModule } from './modules/choices/choices.module.ts';
import { ProductModel } from './models/product.model.ts';
import { IntemptEventListenerName, IntemptEventName } from './types/constants.types.ts';





export class IntemptJs extends IntemptJsGuard {
  private readonly _api = import.meta.env.VITE_API;
  private readonly _autoTracker!:AutoTrackerModule;
  private readonly _choices!:ChoicesModule;

  private readonly _config:IntemptConfig;


  constructor(config:IntemptConfig) {
    super();
    this._config = { ...config};

    if(!this.isValidConfig(config)) return

    this._autoTracker = new AutoTrackerModule(this._config, this._api);

    this._autoTracker.init();

    this._choices = new ChoicesModule({
      ...config,
      profileId: this._autoTracker.getProfileId(),
      sessionId: this._autoTracker.getSessionId(),
    });

    this._choices.init();
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
    console.log('group',eventData);
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

    console.log('track',eventData);
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
   * */
  consent(params: ConsentParams):void {
    if (!this.isUserOptIn()) return;
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

    dispatchIntemptEvent('intempt:logOut', {
      eventName: 'Log Out'
    });
  }

  async recommendation (params:RecommendationParams){
    const {organization, sourceId, project, writeKey} = this._config;
    const {id, quantity, fields} = params
    const url = `${this._api}/${organization}/projects/${project}/feeds/${id}/data`;
    const [ username, password ] = writeKey.split('.');
    const profileId = this._autoTracker.getProfileId();
    const body = {
      profileId,
      sourceId,
      limit: quantity,
      fields
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
