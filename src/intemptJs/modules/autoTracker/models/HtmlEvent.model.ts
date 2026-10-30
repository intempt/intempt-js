import {
  HtmlEventModelParams,
  HtmlEventPayload,
  IntemptHtmlEventNames,
} from '../../../types/autoTracker.types.ts';
import { generateId, eventTimestamp } from '../../../../shared/shared.utils.ts';

export class HtmlEventModel {
  private readonly name: IntemptHtmlEventNames;
  private readonly payload: HtmlEventPayload[] = [];

  constructor({
    name,
    data,
    sessionId,
    profileId,
    pageId,
  }: HtmlEventModelParams) {
    this.name = name;
    this.payload.push({
      eventId: generateId('ev'),
      timestamp: eventTimestamp(),
      sessionId,
      profileId,
      pageId,
      data: data,
    });
  }
}
