import { eventTimestamp, generateId } from '../../../../shared/shared.utils.ts';
import { IntemptEventName } from '../../../types/constants.types.ts';
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
      // A View Page keeps `pageId` as its eventId: one page view, one id, so a
      // retried View Page stays idempotent. A Leave Page must NOT share it
      // (INT-5939): the batcher evicts any item whose eventId it already sent,
      // and ingest dedupes on org + project + eventId with no event name, so a
      // Leave Page carrying its View Page's id was dropped as a duplicate as
      // soon as that View Page had gone out. It links to its page via `pageId`.
      eventId: name === IntemptEventName.PAGE_LEAVE ? generateId('ev') : pageId,
      timestamp: eventTimestamp(),
      sessionId,
      profileId,
      pageId,
      data,
    });
  }
}
