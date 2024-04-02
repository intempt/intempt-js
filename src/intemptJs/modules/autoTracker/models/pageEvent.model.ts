import { IntemptPageEventNames, PageEventPayload } from '../autoTracker.types.ts';
import { generateId } from '../../../../shared/shared.utils.ts';


export class PageEventModel {
   private readonly name: IntemptPageEventNames;
   private readonly payload: PageEventPayload[] = [];

   constructor({ name, sessionId, profileId, pageId, data }:any) {
     this.name = name;
     this.payload.push({
       eventId: generateId(),
       timestamp: new Date().getTime(),
       sessionId,
       profileId,
       pageId,
       data
     })
   }
}
