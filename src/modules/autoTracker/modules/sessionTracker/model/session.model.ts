import { generateId } from '../../../../../shared/shared.utils.ts'


type SessionEventParams = {
  name:string,
  sessionId:string;
  profileId:string;
  data:any;
  userAttributes:any

}

type SessionEventPayload = {
  eventId:string;
  sessionId:string;
  profileId:string;
  data:any;
  userAttributes:any
}

export class SessionEvent {
  _name:string;
  _payload: SessionEventPayload;

  constructor({ name, sessionId, profileId, userAttributes, data }:SessionEventParams) {
    this._name = name;
    this._payload = {
      eventId: generateId(),
      sessionId,
      profileId,
      userAttributes,
      data,

    }


  }






}

