import { debounce, dispatchIntemptEvent } from '../../../../../shared/shared.utils.ts';
import { domEvent, DomEventName, IntemptHtmlEventNames } from '../../../../types/autoTracker.types.ts';
import { IntemptDomEventName, IntemptEventListenerName, IntemptEventName } from '../../../../types/constants.types.ts';


export class HtmlTrackerModule {
  private readonly _domEvents: domEvent[] = [
    {
      domEventName: IntemptDomEventName.CLICK,
      intemptEventName: IntemptEventName.CLICK_ON
    },
    {
      domEventName: IntemptDomEventName.CHANGE,
      intemptEventName: IntemptEventName.CHANGE_ON
    },
    {
      domEventName: IntemptDomEventName.SUBMIT,
      intemptEventName: IntemptEventName.SUBMIT_ON
    }
  ];

   init() {
     this._domEvents.forEach((event) => {
       const {domEventName, intemptEventName} = event;

       switch (domEventName){
         case IntemptDomEventName.CLICK:
           document.addEventListener(domEventName,(event) => this._handleEvent(domEventName,intemptEventName, event));
           break;
         default:
           const debouncedListener = debounce((event:Event) => this._handleEvent(domEventName,intemptEventName, event), 250);
           document.addEventListener(domEventName, debouncedListener);
         break;
       }
     })
   }

  private _handleEvent(domEventName: DomEventName, eventName: IntemptHtmlEventNames, event: Event){
    const target = event.target as HTMLElement;
    dispatchIntemptEvent(IntemptEventListenerName.HTML, {
      eventName,
      domEventName,
      target
    });
  }

}
