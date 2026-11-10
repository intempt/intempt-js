import { ChoicesRequestData } from '../../../types/choices.types.ts';

export class ChoicesRequestModel {
  identification: {
    sourceId: string;
    profileId: string;
  } = undefined!;
  url: string = undefined!;
  device: string = undefined!;
  sessionId: string = undefined!;
  productId: string | null | undefined = undefined!;

  constructor({
    sourceId,
    profileId,
    url,
    device,
    sessionId,
    productId,
  }: ChoicesRequestData) {
    this.identification = {
      sourceId,
      profileId,
    };
    this.productId = productId;
    this.url = url;
    this.device = device;
    this.sessionId = sessionId;
  }
}
