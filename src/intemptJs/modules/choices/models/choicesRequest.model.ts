import { ChoicesRequestData } from '../../../types/choices.types.ts';

export class ChoicesRequestModel {
  identification: {
    sourceId:string
    profileId:string
  };
  url: string;
  device: string;
  sessionId: string;

  constructor({sourceId, profileId, url, device, sessionId}:ChoicesRequestData) {

    this.identification = {
      sourceId,
      profileId
    }
    this.url = url;
    this.device = device;
    this.sessionId = sessionId
  }
}
