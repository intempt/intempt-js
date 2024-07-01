import { debounce, dispatchIntemptEvent } from '../../../../../shared/shared.utils.ts';
import { domEvent, DomEventName, IntemptHtmlEventNames } from '../../../../types/autoTracker.types.ts';


export class HtmlTrackerModule {
  constructor() {}

  private readonly _domEvents: domEvent[] = [
    {
      domEventName: 'click',
      intemptEventName: 'Click On'
    },
    {
      domEventName: 'change',
      intemptEventName: 'Change On'
    },
    // {
    //   domEventName: 'input',
    //   intemptEventName: 'Change On'
    // },
    {
      domEventName: 'submit',
      intemptEventName: 'Submit On'
    }
  ];


   init() {
    // const debounceWaitTime = 250;
     this._domEvents.forEach((event) => {
       const {domEventName, intemptEventName} = event;

       switch (domEventName){
         case 'click':
           document.addEventListener(domEventName,(event) => this._handleEvent(domEventName,intemptEventName, event));
           break;
         // case 'input':
         //   const inputListener = debounce((event:Event) => this._handleEvent(domEventName,intemptEventName, event), 1000);
         //   document.addEventListener(domEventName, inputListener);
         //   break;

         default:
           const debouncedListener = debounce((event:Event) => this._handleEvent(domEventName,intemptEventName, event), 250);
           document.addEventListener(domEventName, debouncedListener);
         break;
       }
     })
   }



  private _handleEvent(domEventName: DomEventName, eventName: IntemptHtmlEventNames, event: Event){
    const target = event.target as HTMLElement;
    dispatchIntemptEvent('intempt:html', {
      eventName,
      domEventName,
      target
    });
  }

}
