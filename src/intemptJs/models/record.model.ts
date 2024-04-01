import {  RecordParams } from '../intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';


export class RecordModel {
  private readonly name: string;
  private readonly payload: {
    eventId: string;
    timestamp: number;
    profileId: string;
    accountId: string | undefined;
    userId: string | undefined;
    data?:{[key:string]:any}
    accountAttributes?:{[key:string]:any}
    userAttributes?:{[key:string]:any}
  }[] = [];

  constructor(params: RecordParams &  {profileId:string}) {
    this.name = params.eventTitle;
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      profileId: params.profileId,
      userId: params.userId ?? undefined,
      accountId: params.accountId ?? undefined,
      data: params.data ?? undefined,
      userAttributes: params.userAttributes ?? undefined,
      accountAttributes: params.accountAttributes ?? undefined
    })
  }
}
