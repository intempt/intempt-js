import { ChoicesRequestData } from '../../../types/choices.types.ts';


export class ChoicesRequestModel {
  identification: {
    sourceId:string
    profileId:string
  };
  url: string;
  device: string;
  sessionId: string;
  productId:string | null | undefined;

  constructor({sourceId, profileId, url, device, sessionId, productId}:ChoicesRequestData) {


    this.identification = {
      sourceId,
      profileId
    }
    this.productId = productId;
    this.url = url;
    this.device = device;
    this.sessionId = sessionId
  }
}
