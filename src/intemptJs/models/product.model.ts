import { ProductModelPayload } from '../types/autoTracker.types.ts';
import { ModelProduct } from '../interfaces/baseModel.interface.ts';
import { IntemptIdsParams, ProductParams } from '../types/intemptJs.types.ts';
import { generateId } from '../../shared/shared.utils.ts';


export class ProductModel implements ModelProduct {
  readonly name: string;
  readonly type = 'product';
  readonly payload: ProductModelPayload[] = [];

  constructor(params: {eventTitle:string, products: ProductParams[] } & IntemptIdsParams) {
    this.name = params.eventTitle;
    this.payload.push(
      ...params.products.map( product => ({
        eventId: generateId('ev'),
        //timestamp: new Date().getTime(),
        profileId: params.profileId!,
        sessionId: params.sessionId!,
        pageId: params.pageId!,
        data: product
    })))
  }

  get _name(): string {
    return '';
  }
}
