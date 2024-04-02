import { generateId } from '../../../../shared/shared.utils.ts'
import { IntemptSessionEventNames, SessionEventParams, SessionEventPayload } from '../autoTracker.types.ts';




export class SessionEventModel {
  name:IntemptSessionEventNames;
  private readonly payload: SessionEventPayload[] = [];

  constructor({ name, sessionId, profileId, userAttributes, data }:SessionEventParams) {
    this.name = name;
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      sessionId,
      profileId,
      userAttributes,
      data,
    })
  }
}

