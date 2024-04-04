import { IntemptIdsParams, TrackParams } from '../types/intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';
import { TrackModelPayload } from '../types/autoTracker.types.ts';
import { ModelTrack } from '../interfaces/baseModel.interface.ts';


export class TrackModel implements ModelTrack {
   readonly name: string;
   readonly type = 'track';
   readonly payload: TrackModelPayload[] = [];

  constructor(params: TrackParams & IntemptIdsParams) {
    this.name = params.eventTitle;
    this.payload.push({
      eventId: generateId('ev'),
      timestamp: new Date().getTime(),
      sessionId: params.sessionId!,
      pageId: params.pageId!,
      profileId: params.profileId!,
      data: params.data
    })

  }

  get _name(): string {
    return this.name;
  }
}
