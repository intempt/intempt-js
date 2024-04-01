import { TrackParams } from '../intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';


export class TrackModel {
  private readonly name: string;
  private readonly payload: {
    eventId: string;
    timestamp: number;
    profileId: string;
    data:{[key:string]:any}
  }[] = [];

  constructor(params: TrackParams & {profileId:string}) {
    this.name = params.eventTitle;
    this.payload.push({
      eventId: generateId(),
      timestamp: new Date().getTime(),
      profileId: params.profileId,
      data: params.data
    })

  }
}
