import { IdentifyParams, IntemptIdsParams } from '../types/intemptJs.types.ts';
import { generateId, eventTimestamp } from '../../shared/shared.utils.ts';
import { IdentifyModelPayload } from '../types/autoTracker.types.ts';
import { ModelIdentify } from '../interfaces/baseModel.interface.ts';

export class IdentifyModel implements ModelIdentify {
  readonly name: string;
  readonly type = 'identify';
  readonly payload: IdentifyModelPayload[] = [];

  constructor(params: IdentifyParams & IntemptIdsParams) {
    this.name = params.eventTitle ?? 'Identify';

    this.payload.push({
      eventId: generateId('ev'),
      timestamp: eventTimestamp(),
      profileId: params.profileId!,
      sessionId: params.sessionId!,
      pageId: params.pageId!,
      userId: params.userId,
      userAttributes: params.userAttributes ?? undefined,
      data: params.data ?? undefined,
    });
  }

  get _name() {
    return this.name;
  }
}
