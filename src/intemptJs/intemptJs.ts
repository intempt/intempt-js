import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts'
import {
  AliasParams,
  ConsentParams,
  GroupParams,
  IdentifyParams, IntemptConfig,
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





export class IntemptJs extends IntemptJsGuard {
  private readonly _api = import.meta.env.VITE_API;
  private readonly _autoTracker:AutoTrackerModule

  private readonly _config:IntemptConfig;


  private _doNotTrack: boolean = false;

  constructor(config:IntemptConfig) {
    super();
    this._config = { ...config};
    this._autoTracker = new AutoTrackerModule(this._config, this._api);

    if(!this.isValidConfig(config)) return

    this._autoTracker.init();
  }


  /**
   * Allow tracking
   * @return void
   * */
  optIn(){
    this._doNotTrack = false;
  }

  /**
   * Disable tracking
   * @return void
   * */
  optOut(){
    this._doNotTrack = true;
  }

  /**
   * Check track availability
   * @return { boolean }
   * Default: true
   * */
  isUserOptIn(): boolean{
    return !this._doNotTrack
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

    const eventData = new IdentifyModel({
      ...params,
      profileId,
      sessionId
    })
    console.log('identify',eventData);
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

    const eventData = new GroupModel({
      ...params,
      profileId,
      sessionId
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

    const eventData = new TrackModel({
      ...params,
      profileId,
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


    const eventData = new RecordModel({
      ...params,
      profileId,
    })

    console.log('record',eventData);
    dispatchIntemptEvent('intempt:record', {
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
  }


  alias(params:AliasParams){
    if (!this.isUserOptIn()) return;
    if (!this.isAliasValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();

    const eventData = new AliasModel({
      ...params,
      profileId,
      sessionId
    })

    console.log('alias', eventData)
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

    const eventData = new ConsentModel({
      ...params,
      profileId,
      sourceId
    })
    console.log(' body', eventData)
    dispatchIntemptEvent('intempt:consent', {
      eventName: eventData._name
    });
    dispatchIntemptEvent('intempt:event', { event: eventData});
  }

  logOut(){
    if (!this.isUserOptIn()) return;

    dispatchIntemptEvent('intempt:logOut', {
      eventName: 'Log Out'
    });
  }


}
