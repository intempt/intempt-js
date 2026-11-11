import {
  ConsentAction,
  ConsentParams,
  IntemptIdsParams,
} from '../types/intemptJs.types.ts';
import { ConsentTrack } from '../interfaces/baseModel.interface.ts';
import { eventTimestamp } from '../../shared/shared.utils.ts';

export class ConsentModel implements ConsentTrack {
  readonly type = 'consent';
  readonly action: ConsentAction = undefined!;
  readonly email?: string = undefined!;
  readonly message?: string = undefined!;
  readonly category?: string = undefined!;
  readonly sourceId: string = undefined!;
  readonly profileId: string = undefined!;
  readonly userId?: string = undefined!;
  readonly source = 'web';
  readonly validUntil: number = undefined!;
  readonly timestamp?: number = undefined!;

  constructor(params: ConsentParams & IntemptIdsParams) {
    this.action = params.action;
    this.email = params.email;
    this.message = params.message;
    this.category = params.category;
    this.sourceId = params.sourceId!;
    this.profileId = params.profileId!;
    this.userId = params.userId;
    this.validUntil = params.validUntil;
    this.timestamp = eventTimestamp();
  }

  get _name(): string {
    return this.type;
  }
}
