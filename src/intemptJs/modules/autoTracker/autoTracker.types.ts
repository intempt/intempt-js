import { SessionEventDataComponent } from '../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../component/userAttribute.component.ts';
import { PageEventDataComponent } from '../component/pageEventData.component.ts';
import { HtmlElementDataComponent } from '../component/HtmlEventData.component.ts';





export type UtmKeys = 'utm_campaign' | 'utm_content' | 'utm_medium' | 'utm_source' | 'utm_term';
export type IntemptSessionEventNames = 'Start Session' | 'End Session';
export type IntemptHtmlEventNames = 'Click On' |  'Submit On' | 'Change On';
export type IntemptPageEventNames = 'View Page' | 'Leave Page' ;
export type DomEventName = 'click' | 'submit' | 'change' | 'input' | 'keyup' ;
export type domEvent = {domEventName: DomEventName, intemptEventName: IntemptHtmlEventNames}



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
  expiration?: number,
}

export type HtmlEventParams = {
  name:IntemptHtmlEventNames;
  sessionId:string;
  profileId:string;
  pageId:string;
  data:HtmlElementDataComponent
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
  userId: string;
  userAttributes?:{[key:string]:any}
  data?:{[key:string]:any}
}
