import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts'
import {
  AliasParams,
  ConsentParams,
  GroupParams,
  IdentifyParams, IntemptConfig,
  RecordParams,
  TrackParams,
} from './intemptJs.types.ts';
import { IntemptJsGuard } from './guards/intemptJs.guard.ts';
import { IdentifyModel } from './models/identify.model.ts';
import { GroupModel } from './models/group.model.ts';
import { TrackModel } from './models/track.model.ts';
import { RecordModel } from './models/record.model.ts';
import { AliasModel } from './models/alias.model.ts';
import { dispatchIntemptEvent } from '../shared/shared.utils.ts';





export class IntemptJs extends IntemptJsGuard {
  // private readonly _api = 'http://localhost:3000/api/messages/test';
  private readonly _api = 'https://api.intempt.com/v1';
  private readonly _autoTracker:AutoTrackerModule

  private readonly _config:IntemptConfig;


  private _doNotTrack: boolean = false;

  constructor(config:IntemptConfig) {
    super();
    this._config = { ...config};
    this._autoTracker = new AutoTrackerModule(this._config, this._api);



    if(!this.isValidConfig(config)) return

//<script async src='https://cdn.intempt.com/intempt.min.js?organization=intempt-demo&project=saas-demo&source=496392441735024640&key=9dfc6897a9934274acf8fb7236698ba0.12410a7599ee49528a898ff2764841a9'></script>

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


  //TODO:Finish group method
  consent(params: ConsentParams):void {
     if (!this.isUserOptIn()) return;
     if (!this.isConsentValid(params)) return;

    const body = {
      ...params,
      timestamp: new Date().getTime(),
      source: 'web',
      sourceId: this._config.sourceId,
      profileId: this._autoTracker.getProfileId()
    }
    console.log(' body', body)

    //dispatchIntemptEvent('intempt:event', { event: body});
   //TODO: api = v1/ORG/projects/PROJECT/optimization/choose-api
  }



  identify(params:IdentifyParams){
    if (!this.isUserOptIn()) return;
    if (!this.isIdentifyValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();

    const body = new IdentifyModel({
      ...params,
      profileId,
      sessionId
    })
    console.log('identify',body);
    dispatchIntemptEvent('intempt:event', { event: body});

  }


  group(params:GroupParams){
    if (!this.isUserOptIn()) return;
    if (!this.isGroupValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();

    const body = new GroupModel({
      ...params,
      profileId,
      sessionId
    })

    dispatchIntemptEvent('intempt:event', { event: body});
    console.log('group',body);
  }


  track(params:TrackParams){
    if (!this.isUserOptIn()) return;
    if (!this.isTrackValid(params)) return;

    const profileId = this._autoTracker.getProfileId();

    const body = new TrackModel({
      ...params,
      profileId,
    })

    console.log('track',body);
    dispatchIntemptEvent('intempt:event', { event: body});
  }


  record(params:RecordParams){
    if (!this.isUserOptIn()) return;
    if (!this.isRecordValid(params)) return;

    const profileId = this._autoTracker.getProfileId();


    const body = new RecordModel({
      ...params,
      profileId,
    })

    console.log('record',body);
    dispatchIntemptEvent('intempt:event', { event: body});
  }


  alias(params:AliasParams){
    if (!this.isUserOptIn()) return;
    if (!this.isAliasValid(params)) return;

    const profileId = this._autoTracker.getProfileId();
    const sessionId = this._autoTracker.getSessionId();

    const body = new AliasModel({
      ...params,
      profileId,
      sessionId
    })

    console.log('alias', body)
    dispatchIntemptEvent('intempt:event', { event: body});
  }

  //TODO:Implement logout method
  logOut(){
    const cookie = this._autoTracker.cookieKeys;
    console.log(cookie);

    console.log('logOut')
    return ''
  }


}
