import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts'
import { HtmlEventModel } from './modules/autoTracker/models/HtmlEvent.model.ts';




export class IntemptJs {
  private readonly _autoTracker = new AutoTrackerModule();
  private readonly api = 'http://localhost:6060/api/messages/test';



  // constructor(config:any) {}
  constructor() {
    this._trackEventPool();
    this._autoTracker.init();

  }

  private _trackEventPool() {
      const eventPool:any = [];


      document.addEventListener('intempt:event', (event) => {
        const { detail } = event as CustomEvent;

        if(detail.event instanceof HtmlEventModel){
          console.log('html')
        }
        else{
          console.log('other')
        }

        console.log('Event Pool', detail.event);


        // eventPool.push(event);
        // fetch('http://localhost:3000/api/messages/test', {
        //   method: 'POST',
        //   headers: {
        //     'Content-Type': 'application/json',
        //   },
        //   body: JSON.stringify(detail),
        // }).then()
      });
    }



  /**
   * //TODO
   * Implement getPersonalization method
   * Implement getExperiment method
   *
   * Implement OptIn method
   * Implement OptOut method
   * Implement isUserOptIn method
   *
   *
   * Implement logIn method
   * Implement logout method
   *
   *
   * Implement track method
   * Implement identify method
   * Implement alias method
   * Implement record method
   *
   * */


}
