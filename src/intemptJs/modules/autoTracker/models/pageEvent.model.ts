import { IntemptPageEventNames, PageEventModelParams, PageEventPayload } from '../../../types/autoTracker.types.ts';
import { generateId } from '../../../../shared/shared.utils.ts';


export class PageEventModel {
   private readonly name: IntemptPageEventNames;
   private readonly payload: PageEventPayload[] = [];

   constructor({ name, sessionId, profileId, pageId, data }:PageEventModelParams) {
     this.name = name;
     this.payload.push({
       eventId: pageId,
       timestamp: new Date().getTime(),
       sessionId,
       profileId,
       // pageId,
       data
     })
   }

}
