import { AliasParams, IntemptIdsParams } from '../types/intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';
import { AliasModelPayload } from '../types/autoTracker.types.ts';
import {  ModelAlias } from '../interfaces/baseModel.interface.ts';


export class AliasModel implements ModelAlias {
  readonly name: string;
  readonly type = 'alias';
  readonly payload: AliasModelPayload[] = []

  constructor(params:AliasParams & IntemptIdsParams) {
    this.name = 'Identify'
    this.payload.push({
      eventId: generateId('ev'),
      timestamp: new Date().getTime(),
      profileId: params.profileId!,
      userId: params.userId,
      anotherUserId: params.anotherUserId,
    })
  }

  get _name() { return this.name; }

}
