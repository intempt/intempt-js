import { generateId } from '../../../../shared/shared.utils.ts'
import { IntemptSessionEventNames, SessionEventParams, SessionEventPayload } from '../autoTracker.types.ts';




export class SessionEventModel {
  name:IntemptSessionEventNames;
  payload: SessionEventPayload;

  constructor({ name, sessionId, profileId, userAttributes, data }:SessionEventParams) {
    this.name = name;
    this.payload = {
      eventId: generateId(),
      sessionId,
      profileId,
      userAttributes,
      data,
    }


  }
}

