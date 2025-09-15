import { SessionEventDataComponent } from '../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../component/userAttribute.component.ts';
import { PageEventDataComponent } from '../component/pageEventData.component.ts';
import { HtmlElementDataComponent } from '../component/HtmlEventData.component.ts';
import { DeviceTypeName, IntemptDomEventName, IntemptEventName, UtmKey } from './constants.types.ts';
import { IntemptShopifyEvent } from '../interfaces/events.interface.ts';




export type DeviceType = DeviceTypeName.DESKTOP
                       | DeviceTypeName.TABLET
                       | DeviceTypeName.MOBILE
                       | DeviceTypeName.DEFAULT;
export type Location = {ip: string, region: string, city: string, country: string}

export type UtmKeys = UtmKey.CAMPAIGN
                    | UtmKey.CONTENT
                    | UtmKey.MEDIUM
                    | UtmKey.SOURCE
                    | UtmKey.TERM;
export type IntemptSessionEventNames = IntemptEventName.SESSION_START;
export type IntemptHtmlEventNames = IntemptEventName.CLICK_ON
                                  | IntemptEventName.SUBMIT_ON
                                  | IntemptEventName.CHANGE_ON ;
export type IntemptPageEventName = IntemptEventName.PAGE_VIEW
                                  | IntemptEventName.PAGE_LEAVE;
export type DomEventName = IntemptDomEventName.CLICK
                         | IntemptDomEventName.SUBMIT
                         | IntemptDomEventName.CHANGE
                         | IntemptDomEventName.INPUT
                         | IntemptDomEventName.KEYUP

export type IntemptShopifyAutoTrackedEventNames = IntemptEventName.PRODUCT_VIEW | IntemptEventName.PRODUCT_ADD
export type IntemptShopifyEventNames = IntemptEventName.PRODUCT_VIEW | IntemptEventName.PRODUCT_ADD | IntemptEventName.PRODUCT_ORDER

export type LocationApi = {ip: string, region: string, city: string, country: string}

export type ShopifyEvent = CustomEvent<IntemptShopifyEvent>



export type domEvent = {
  domEventName: DomEventName,
  intemptEventName: IntemptHtmlEventNames
}

export type SessionCookie = {intempt_session : string}

export type SessionCookieObject = {
  id:string;
  startAction:number;
  lastForegroundAction:number | null;
  lastBackgroundAction:number | null;
  lastAction:number;
  eventsCounter:number;
}

export type SessionEventParams = {
  name:IntemptSessionEventNames,
  sessionId:string;
  profileId:string;
  data:SessionEventDataComponent;
  userAttributes: UserAttributeComponent
}

export type SetCookieParams = {
  name: string,
  value: string,
  path: string,
  domain?: string,
  expiration?: number,
}

export type HtmlEventModelParams = {
  name:IntemptHtmlEventNames;
  sessionId:string;
  profileId:string;
  pageId:string;
  data:HtmlElementDataComponent
}

export type PageEventModelParams = {
  name:IntemptPageEventName;
  sessionId:string;
  profileId:string;
  pageId:string;
  data:PageEventDataComponent
}

export type SessionEventPayload = {
  eventId:string;
  sessionId:string;
  profileId:string;
  //timestamp: number;
  data:SessionEventDataComponent;
  userAttributes:UserAttributeComponent
}

export type HtmlEventPayload = {
  eventId: string;
  //timestamp: number;
  sessionId: string;
  profileId: string;
  pageId: string;
  data: HtmlElementDataComponent
}

export type PageEventPayload = {
  sessionId:string;
  profileId:string;
  pageId:string;
  eventId:string;
  //timestamp: number;
  data:PageEventDataComponent
}

export type IdentifyModelPayload = {
  eventId: string;
  //timestamp: number;
  profileId: string;
  sessionId: string;
  pageId:string,
  userId: string;
  userAttributes?:{[key:string]:any}
  data?:{[key:string]:any}
}

export type GroupModelPayload = {
  eventId: string;
  //timestamp: number;
  profileId: string;
  sessionId: string;
  pageId: string;
  accountId: string;
  accountAttributes?:{[key:string]:any}
}

export type TrackModelPayload = {
  eventId: string;
  //timestamp: number;
  profileId: string;
  sessionId: string;
  pageId: string;
  data?:{ [key:string]:any }
}

export type RecordModelPayload = {
  eventId: string;
  //timestamp: number;
  profileId: string;
  pageId?: string;
  sessionId?: string;
  accountId?: string;
  userId?: string;
  data?:{[key:string]:any}
  accountAttributes?:{[key:string]:any}
  userAttributes?:{[key:string]:any}
}

export type AliasModelPayload = {
  eventId: string;
  //timestamp: number;
  profileId: string;
  //sessionId: string;
  userId: string;
  anotherUserId: string;
}

export type ProductModelPayload = {
  eventId: string;
  sessionId: string;
  //timestamp: number;
  profileId: string;
  pageId: string;
  data: {productId:string, quantity?:number}
}




