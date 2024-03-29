import { HtmlElementData } from '../../shared/HtmlElementData.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts'
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts'


export class AutoTrackerModule {
  private readonly _sessionTracker = new SessionTrackerModule();
  private readonly _profileTracker = new ProfileTrackerModule();

  constructor() {}

  public init() {
    this._profileTracker.setProfileId();
    this._sessionTracker.setSessionId();


    this._sessionTracker.start();

    this.onClick();
    this.onChange();
    this.onSubmit();
  }

  private onClick() {
    document.addEventListener('click', (event) => {
      //event.preventDefault();
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.log('onClick', data);
    });
  }
  private onChange() {
    document.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.log('onChange', data);
    });
  }
  private onSubmit() {
    document.addEventListener('submit', (event) => {
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.dir('onSubmit', target);
      console.log('onSubmit', data);
    });
  }


  get sessionId(): string{
    const { sessionId } = this._sessionTracker._getSessionId();
    return sessionId
  }

  get profileId(): string {
    return this._profileTracker._getProfileId();
  }







  onViewPage() {}
  onLeavePage() {}
  onSessionStart() {}
  onSessionEnd() {}

  //SessionStart
  //SessionEnd
}
