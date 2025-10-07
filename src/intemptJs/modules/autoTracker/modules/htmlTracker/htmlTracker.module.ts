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

  private _listeners = new Map<IntemptDomEventName, EventListener>();
  private get root(): HTMLElement | Document {
    // attach to <body> if available; otherwise fall back to document (e.g., very early init)
    return document.body ?? document;
  }

   init() {
     this._domEvents.forEach(({ domEventName, intemptEventName }) => {
       const handler: EventListener = domEventName === IntemptDomEventName.CLICK
           ? (e) => this._handleEvent(domEventName, intemptEventName, e)
           : (debounce((e: Event) => this._handleEvent(domEventName, intemptEventName, e), 250) as unknown as EventListener);

       // keep a reference so we can remove later
       this._listeners.set(domEventName, handler);

       // capture submit early; others bubble fine from body
       const opts: AddEventListenerOptions | boolean = domEventName === IntemptDomEventName.SUBMIT ? { capture: true } : false;

       (this.root as any).addEventListener(domEventName, handler, opts);
     });
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
