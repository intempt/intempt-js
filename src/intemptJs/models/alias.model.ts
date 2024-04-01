import { AliasParams, IntemptIdsParams } from '../intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';


export class AliasModel {
  private readonly name: string;
  private readonly payload: {
    eventId: string;
    timestamp: number;
    profileId: string;
    sessionId: string;
    userId: string;
    anotherUserId: string;
  }[] = []

  constructor(params:AliasParams & IntemptIdsParams) {
    this.name = 'Identify'
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      profileId: params.profileId,
      sessionId: params.sessionId,
      userId: params.userId,
      anotherUserId: params.anotherUserId,
    })
  }
}
