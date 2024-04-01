import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts'
import {
  AliasParams,
  ConsentAction,
  ConsentParams,
  GroupParams,
  IdentifyParams,
  IntemptConfig, RecordParams,
  TrackParams,
} from './intemptJs.types.ts';
import { IntemptJsGuard } from './guards/intemptJs.guard.ts';
import { IdentifyModel } from './models/identify.model.ts';
import { GroupModel } from './models/group.model.ts';
import { TrackModel } from './models/track.model.ts';
import { RecordModel } from './models/record.model.ts';
import { AliasModel } from './models/alias.model.ts';





export class IntemptJs extends IntemptJsGuard {

  private readonly _organization:string;
  private readonly _sourceId:string;
  private readonly _project:string;
  private readonly _writeKey:string;
  private readonly api = 'http://localhost:6060/api/messages/test';
  private readonly _autoTracker = new AutoTrackerModule();


  private _doNotTrack: boolean = false;

  constructor(config:any) {
    super();

    this._organization = config.organization;
    this._sourceId = config.sourceId;
    this._project = config.project;
    this._writeKey = config.writeKey;
    console.log('config: ',config);
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


  //TODO:Finish group method
  consent(params: ConsentParams):void {
     if (!this.isUserOptIn()) return;
     if (!this.isConsentValid(params)) return;

    const body = {
      ...params,
      timestamp: new Date().getTime(),
      source: 'web',
      sourceId: this._sourceId,
      profileId: this._autoTracker._getProfileId()
    }
    console.log(' body', body)

   //TODO: api = v1/ORG/projects/PROJECT/optimization/choose-api
  }

  //TODO:?? ask about 'data' field ??
  //TODO:Finish group method
  identify(params:IdentifyParams){
    if (!this.isUserOptIn()) return;
    if (!this.isIdentifyValid(params)) return;

    const profileId = this._autoTracker._getProfileId();
    const sessionId = this._autoTracker._getSessionId();

    const body = new IdentifyModel({
      ...params,
      profileId,
      sessionId
    })

    console.log('identify',body);
  }

  //TODO:Finish  group method
  group(params:GroupParams){
    if (!this.isUserOptIn()) return;
    if (!this.isGroupValid(params)) return;

    const profileId = this._autoTracker._getProfileId();
    const sessionId = this._autoTracker._getSessionId();

    const body = new GroupModel({
      ...params,
      profileId,
      sessionId
    })


    console.log('group',body);
  }

  //TODO:Finish track method
  track(params:TrackParams){
    if (!this.isUserOptIn()) return;
    if (!this.isTrackValid(params)) return;

    const profileId = this._autoTracker._getProfileId();

    const body = new TrackModel({
      ...params,
      profileId,
    })

    console.log('track',body);
  }

  //TODO:Finish  record method
  record(params:RecordParams){
    if (!this.isUserOptIn()) return;
    if (!this.isRecordValid(params)) return;

    const profileId = this._autoTracker._getProfileId();


    const body = new RecordModel({
      ...params,
      profileId,
    })

    console.log('record',body);
  }

  //TODO:Finish alias method
  alias(params:AliasParams){
    if (!this.isUserOptIn()) return;
    if (!this.isAliasValid(params)) return;

    const profileId = this._autoTracker._getProfileId();
    const sessionId = this._autoTracker._getSessionId();

    const body = new AliasModel({
      ...params,
      profileId,
      sessionId
    })

    console.log('alias', body)
  }


  //TODO:Implement logIn method
  logIn(){
    console.log('logIn',)
    return ''
  }

  //TODO:Implement logout method
  logOut(){
    console.log('logOut')
    return ''
  }



  //TODO:Implement getExperiment method
  getExperiment(args?:any){
    console.log('getExperiment',args)


    return ''
  }


  //TODO:Implement getPersonalization method
  getPersonalization(args?:any){
    console.log('getPersonalization', args)


    return ''
  }

}
