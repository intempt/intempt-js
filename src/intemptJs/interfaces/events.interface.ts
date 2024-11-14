import { ProductParams } from '../types/intemptJs.types.ts';
import { IntemptShopifyEventNames } from '../types/autoTracker.types.ts';

export interface IntemptShopifyEvent {
  eventName: IntemptShopifyEventNames;
  product: ProductParams;
}
