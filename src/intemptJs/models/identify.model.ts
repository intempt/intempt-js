import { IdentifyParams, IntemptIdsParams } from '../intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';


export class IdentifyModel {
  private readonly name: string;
  private readonly payload: {
     eventId: string;
     timestamp: number;
     profileId: string;
     sessionId: string;
     userId: string;
     userAttributes?:{[key:string]:any}
     data?:{[key:string]:any}

  }[] = [];



  constructor(params: IdentifyParams & IntemptIdsParams ) {
    this.name = params.eventTitle ?? 'Identify';
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      profileId: params.profileId,
      sessionId: params.sessionId,
      userId: params.userId,
      userAttributes: params.userAttributes ?? undefined,
      data: params.data ?? undefined
    })
  }
}
