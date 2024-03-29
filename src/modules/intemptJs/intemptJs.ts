import { AutoTrackerModule } from '../autoTracker/autoTracker.module.ts'


export class IntemptJs {
  private readonly _autoTracker = new AutoTrackerModule();

  private _sessionId: string;
  private _profileId: string;

  constructor({
    organization,project, source, apiKey
  }) {
    this._autoTracker.init();


    this._sessionId = this._autoTracker.sessionId;
    this._profileId = this._autoTracker.profileId;


    console.log('_sessionId: ',this._sessionId)
    console.log('_profileId: ',this._profileId)

  }






}
