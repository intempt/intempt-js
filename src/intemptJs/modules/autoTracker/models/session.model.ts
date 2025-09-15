import { generateId } from '../../../../shared/shared.utils.ts'
import { IntemptSessionEventNames, SessionEventParams, SessionEventPayload } from '../../../types/autoTracker.types.ts';




export class SessionEventModel {
  readonly name:IntemptSessionEventNames;
  readonly payload: SessionEventPayload[] = [];

  constructor({ name, sessionId, profileId, userAttributes, data }:SessionEventParams) {
    this.name = name;
    this.payload.push({
      eventId: sessionId,
      //timestamp: new Date().getTime(),
      sessionId,
      profileId,
      userAttributes,
      data,
    })
  }
}

