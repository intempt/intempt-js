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
  private readonly source =  'web';
  private readonly sessionEventCount?:number;
  private readonly sessionDuration?:number;



  constructor(sessionStartEventName:string, eventCount?:number, sessionDuration?:number) {
    const {
      query,
      utmTerm,
      urlHash,
      utmSource,
      utmMedium,
      utmContent,
      utmCampaign
    } = new BaseURLParser();


    this.sessionEventCount = eventCount;
    this.sessionDuration = !!sessionDuration ? Math.round(sessionDuration / 1000) : sessionDuration;
    this.sessionStartEventName = sessionStartEventName;
    this.landingPageQuery = query;
    this.landingPageHash = urlHash;
    this.utmCampaign = utmCampaign;
    this.utmContent = utmContent;
    this.utmMedium = utmMedium;
    this.utmSource = utmSource;
    this.utmTerm = utmTerm;

  }
}
