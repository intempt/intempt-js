import { GroupParams,  IntemptIdsParams } from '../types/intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';
import { GroupModelPayload } from '../types/autoTracker.types.ts';
import {  ModelGroup } from '../interfaces/baseModel.interface.ts';

export class GroupModel implements ModelGroup{
  readonly name: string;
  readonly type = 'group';
  readonly payload: GroupModelPayload[] = []

  constructor(params: GroupParams & IntemptIdsParams) {
    this.name = params.eventTitle ?? 'Identify';

    this.payload.push({
      eventId: generateId('ev'),
      timestamp: new Date().getTime(),
      profileId: params.profileId!,
      sessionId: params.sessionId!,
      accountId: params.accountId,
      accountAttributes: params.accountAttributes ?? undefined
    })
  }

  get _name() { return this.name; }
}
