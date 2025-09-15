import { ConsentAction, ConsentParams, IntemptIdsParams } from '../types/intemptJs.types.ts';
import { ConsentTrack } from '../interfaces/baseModel.interface.ts';


export class ConsentModel implements ConsentTrack {
  readonly type = 'consent';
  readonly action: ConsentAction;
  readonly email?:string;
  readonly message?: string;
  readonly category?: string;
  readonly sourceId: string;
  readonly profileId: string;
  readonly source = 'web';
  readonly validUntil: number;
  readonly timestamp?: number;

  constructor(params: ConsentParams & IntemptIdsParams) {
    this.action = params.action;
    this.email = params.email;
    this.message = params.message;
    this.category = params.category;
    this.sourceId = params.sourceId!;
    this.profileId = params.profileId!;
    this.validUntil = params.validUntil;
    //this.timestamp = new Date().getTime();
  }

  get _name(): string {
    return this.type;
  }
}
