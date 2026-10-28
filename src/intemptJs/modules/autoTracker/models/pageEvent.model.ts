import { eventTimestamp } from '../../../../shared/shared.utils.ts';
import {
  IntemptPageEventName,
  PageEventModelParams,
  PageEventPayload,
} from '../../../types/autoTracker.types.ts';

export class PageEventModel {
  private readonly name: IntemptPageEventName;
  private readonly payload: PageEventPayload[] = [];

  constructor({
    name,
    sessionId,
    profileId,
    pageId,
    data,
  }: PageEventModelParams) {
    this.name = name;
    this.payload.push({
      eventId: pageId,
      timestamp: eventTimestamp(),
      sessionId,
      profileId,
      pageId,
      data,
    });
  }
}
