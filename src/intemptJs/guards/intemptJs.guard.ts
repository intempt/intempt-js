import {
  AliasParams,
  ConsentParams,
  GroupParams,
  IdentifyParams,
  RecordParams,
  TrackParams,
} from '../types/intemptJs.types.ts';


export class IntemptJsGuard {

  private readonly _forbiddenEventNames:string[] = [
    'auto-track',
    'view page',
    'leave page',
    'change on',
    'click on',
    'submit on',
    'identify',
    'consent',
  ];

  isValidConfig(params:any){
    if (
      params.organization === '' ||
      params.sourceId === '' ||
      params.project === '' ||
      params.writeKey === ''
    ) {
      throw new Error('IntemptJs initialization failed: All config fields must be provided.');
    }

    return true
  }


  isConsentValid(params: ConsentParams): params is ConsentParams {
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'consent' method are required.");
    }

    if (params.action === undefined || params.action === null) {
      throw new Error('Consent parameters are invalid: action is required.');
    }
    if (params.action !== 'reject' && params.action !== 'accept') {
      throw new Error('Consent parameters are invalid: action should be either "reject" or "accept".');
    }
    return true;
  }

  isIdentifyValid(params: IdentifyParams){
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'identify' method are required.");
    }

    if(params.eventTitle && this._forbiddenEventNames.includes(params.eventTitle.toLowerCase())){
      throw new Error(
        `The '${params.eventTitle}' event title is forbidden`
      );
    }

    if (params.userId === undefined || params.userId === null) {
      throw new Error(
        "Identify parameters are invalid: 'userId' is required."
      );
    }


    if(!params.eventTitle && params.userAttributes){
      throw new Error(
        "Identify parameters are invalid: set 'eventTitle' to use 'userAttributes'."
      );
    }
    return true
  }

  isGroupValid(params: GroupParams){
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'group' method are required.");
    }
    if(params.eventTitle && this._forbiddenEventNames.includes(params.eventTitle.toLowerCase())){
      throw new Error(
        `The '${params.eventTitle}' event title is forbidden`
      );
    }



    if (params.accountId === undefined || params.accountId === null) {
      throw new Error(
        "Group parameters are invalid: 'accountId' is required."
      );
    }

    if(!params.eventTitle && params.accountAttributes){
      throw new Error(
        "Group parameters are invalid: set 'eventTitle' to use 'accountAttributes'."
      );
    }

    return true
  }

  isTrackValid(params: TrackParams){
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'track' method are required.");
    }


    if (params.eventTitle === undefined || params.eventTitle === null) {
      throw new Error('Track parameters are invalid: eventTitle is required.');
    }

    if(this._forbiddenEventNames.includes(params.eventTitle.toLowerCase())){
      throw new Error(
        `The '${params.eventTitle}' event title is forbidden`
      );
    }

    if (params.data === undefined || params.data === null || Object.keys(params.data).length === 0) {
      throw new Error("Track parameters are invalid: 'data' can't be empty.");
    }

    return true
  }

  isRecordValid(params: RecordParams){
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'record' method are required.");
    }

    if (params.eventTitle === undefined || params.eventTitle === null) {
      throw new Error('Record parameters are invalid: eventTitle is required.');
    }

    if(this._forbiddenEventNames.includes(params.eventTitle.toLowerCase())){
      throw new Error(
        `The '${params.eventTitle}' event title is forbidden`
      );
    }

    return true
  }

  isAliasValid(params:AliasParams){
    if (params === undefined || params === null || Object.keys(params).length === 0) {
      throw new Error("Parameters for the 'alias' method are required.");
    }

    if (params.userId === undefined || params.userId === null) {
      throw new Error('Alias parameters are invalid: userId is required.');
    }

    if (params.anotherUserId === undefined || params.anotherUserId === null) {
      throw new Error('Alias parameters are invalid: anotherUserId is required.');
    }

    return true;
  }

}
