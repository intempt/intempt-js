import { IntemptPageEventName, PageEventModelParams, PageEventPayload } from '../../../types/autoTracker.types.ts';



export class PageEventModel {
   private readonly name: IntemptPageEventName;
   private readonly payload: PageEventPayload[] = [];

   constructor({ name, sessionId, profileId, pageId, data }:PageEventModelParams) {
     this.name = name;
     this.payload.push({
       eventId: pageId,
       timestamp: new Date().getTime(),
       sessionId,
       profileId,
       pageId,
       data
     })
   }

}
