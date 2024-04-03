import { BaseURLParser } from '../_baseUrlParser.ts';

export class SessionEventDataComponent{
  private readonly sessionStartEventName:string;
  private readonly landingPageQuery:string;
  private readonly landingPageHash:string;
  private readonly utmCampaign:string;
  private readonly utmContent:string;
  private readonly utmMedium:string;
  private readonly utmSource:string;
  private readonly utmTerm:string;
  private readonly source:string;
  private readonly sessionEventCount?:number;
  private readonly sessionDuration?:number;



  constructor(sessionStartEventName:string, source = 'web'){
    const {
      query,
      utmTerm,
      urlHash,
      utmSource,
      utmMedium,
      utmContent,
      utmCampaign
    } = new BaseURLParser();


    this.sessionStartEventName = sessionStartEventName;
    this.landingPageQuery = query;
    this.landingPageHash = urlHash;
    this.utmCampaign = utmCampaign;
    this.utmContent = utmContent;
    this.utmMedium = utmMedium;
    this.utmSource = utmSource;
    this.utmTerm = utmTerm;
    this.source = source;
  }
}
