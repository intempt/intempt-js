import { HtmlEventModelParams, HtmlEventPayload, IntemptHtmlEventNames } from '../autoTracker.types.ts';
import { generateId } from '../../../../shared/shared.utils.ts';
import { HtmlElementDataComponent } from '../../../component/HtmlEventData.component.ts';


export class HtmlEventModel {
  private readonly name: IntemptHtmlEventNames
  private readonly payload: HtmlEventPayload[] = [];




  constructor({name, data, sessionId, profileId, pageId}:HtmlEventModelParams) {
    this.name = name;
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      sessionId,
      profileId,
      pageId,
      data: data
    })
  }
}
