import { GroupParams,  IntemptIdsParams } from '../intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';

export class GroupModel {
  private readonly name: string;
  private readonly payload: {
    eventId: string;
    timestamp: number;
    profileId: string;
    sessionId: string;
    accountId: string;
    accountAttributes?:{[key:string]:any}
  }[] = []

  constructor(params: GroupParams & IntemptIdsParams) {
    this.name = params.eventTitle ?? 'Identify';

    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      profileId: params.profileId,
      sessionId: params.sessionId,
      accountId: params.accountId,
      accountAttributes: params.accountAttributes ?? undefined
    })





  }
}
