import { SessionEventDataComponent } from '../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../component/userAttribute.component.ts';
import { PageEventDataComponent } from '../component/pageEventData.component.ts';
import { HtmlElementData } from '../../../shared/HtmlElementData.ts';



export type UtmKeys = 'utm_campaign' | 'utm_content' | 'utm_medium' | 'utm_source' | 'utm_term';
export type IntemptSessionEventNames = 'Start Session' | 'End Session';
export type IntemptHtmlEventNames = 'Click On' |  'Submit On' | 'Change On';
export type IntemptPageEventNames = 'View Page' | 'Leave Page' ;
export type DomEventName = 'click' | 'submit' | 'change' | 'input' | 'keyup' ;
export type domEvent = {domEventName: DomEventName, intemptEventName: IntemptHtmlEventNames}

export type SessionEventParams = {
  name:IntemptSessionEventNames,
  sessionId:string;
  profileId:string;
  data:SessionEventDataComponent;
  userAttributes: UserAttributeComponent
}

export type HtmlEventParams = {
  name:IntemptHtmlEventNames;
  sessionId:string;
  profileId:string;
  pageId:string;
  data:HtmlElementData
}



export type SessionEventPayload = {
  eventId:string;
  sessionId:string;
  profileId:string;
  data:SessionEventDataComponent;
  userAttributes:UserAttributeComponent
}

export type SetCookieParams = {
  name: string,
  value: string,
  path: string,
  maxAge?: number,
}

export type PageEventPayload = {
  sessionId:string;
  profileId:string;
  pageId:string;
  eventId:string;
  data:PageEventDataComponent
}
