import { IntemptIdsParams, RecordParams } from '../types/intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';
import { RecordModelPayload } from '../types/autoTracker.types.ts';
import { ModelRecord } from '../interfaces/baseModel.interface.ts';


export class RecordModel implements ModelRecord {
  readonly name: string;
  readonly type = 'record';
  readonly payload: RecordModelPayload[] = [];

  constructor(params: RecordParams &  IntemptIdsParams) {
    this.name = params.eventTitle;
    this.payload.push({
      eventId: generateId('ev'),
      //timestamp: new Date().getTime(),
      profileId: params.profileId!,
      sessionId: params.sessionId!,
      pageId: params.pageId!,
      userId: params.userId ?? undefined,
      accountId: params.accountId ?? undefined,
      data: params.data ?? undefined,
      userAttributes: params.userAttributes ?? undefined,
      accountAttributes: params.accountAttributes ?? undefined
    })
  }

  get _name(): string {
    return '';
  }
}



