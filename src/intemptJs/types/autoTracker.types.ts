import { SessionEventDataComponent } from '../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../component/userAttribute.component.ts';
import { PageEventDataComponent } from '../component/pageEventData.component.ts';
import { HtmlElementDataComponent } from '../component/HtmlEventData.component.ts';




export type DeviceType = 'Desktop'|'Tablet'|'Mobile'| 'Not Recognized';
export type Location = {ip: string, region: string, city: string, country: string}

export type UtmKeys = 'utm_campaign' | 'utm_content' | 'utm_medium' | 'utm_source' | 'utm_term';
export type IntemptSessionEventNames = 'Session start';
export type IntemptHtmlEventNames = 'Click On' |  'Submit On' | 'Change On';
export type IntemptPageEventNames = 'View Page' | 'Leave Page' ;
export type DomEventName = 'click' | 'submit' | 'change' | 'input' | 'keyup' ;

export type LocationApi = {ip: string, region: string, city: string, country: string}

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
  name:IntemptPageEventNames;
  sessionId:string;
  profileId:string;
  pageId:string;
  data:PageEventDataComponent
}

export type SessionEventPayload = {
  eventId:string;
  sessionId:string;
  profileId:string;
  timestamp: number;
  data:SessionEventDataComponent;
  userAttributes:UserAttributeComponent
}

export type HtmlEventPayload = {
  eventId: string;
  timestamp: number;
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
  timestamp: number;
  data:PageEventDataComponent
}

export type IdentifyModelPayload = {
  eventId: string;
  timestamp: number;
  profileId: string;
  sessionId: string;
  pageId:string,
  userId: string;
  userAttributes?:{[key:string]:any}
  data?:{[key:string]:any}
}

export type GroupModelPayload = {
  eventId: string;
  timestamp: number;
  profileId: string;
  sessionId: string;
  pageId: string;
  accountId: string;
  accountAttributes?:{[key:string]:any}
}

export type TrackModelPayload = {
  eventId: string;
  timestamp: number;
  profileId: string;
  sessionId: string;
  pageId: string;
  data?:{ [key:string]:any }
}

export type RecordModelPayload = {
  eventId: string;
  timestamp: number;
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
  timestamp: number;
  profileId: string;
  //sessionId: string;
  userId: string;
  anotherUserId: string;
}




