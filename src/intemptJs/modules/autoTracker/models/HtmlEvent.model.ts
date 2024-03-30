import { HtmlEventParams, IntemptHtmlEventNames } from '../autoTracker.types.ts';
import { generateId } from '../../../../shared/shared.utils.ts';


export class HtmlEventModel {
  readonly name:IntemptHtmlEventNames
  readonly payload: any;
  constructor({name, data, sessionId, profileId, pageId}:HtmlEventParams) {
    this.name = name;
    this.payload = {
      eventId: generateId(),
      sessionId,
      profileId,
      pageId,
      data,
    }
  }
}
