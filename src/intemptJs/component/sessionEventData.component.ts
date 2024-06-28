import { BaseURLParser } from '../_baseUrlParser.ts';


type Props = {
  sessionStartEventName:string;
  eventCount?:number;
  sessionDuration?:number;
  query:string;
  urlHash:string;

}

export class SessionEventDataComponent{
  private readonly sessionStartEventName:string;
  private readonly landingPageQuery:string;
  private readonly landingPageHash:string;
  // private readonly utmCampaign:string;
  // private readonly utmContent:string;
  // private readonly utmMedium:string;
  // private readonly utmSource:string;
  // private readonly utmTerm:string;
  private readonly source =  'web';


  constructor({ sessionStartEventName, query, urlHash}:Props) {
    // const {
    //   query,
    //   utmTerm,
    //   urlHash,
    //   utmSource,
    //   utmMedium,
    //   utmContent,
    //   utmCampaign
    // } = new BaseURLParser();

    this.sessionStartEventName = sessionStartEventName;
    this.landingPageQuery = query;
    this.landingPageHash = urlHash;
    //
    // this.utmCampaign = utmCampaign;
    // this.utmContent = utmContent;
    // this.utmMedium = utmMedium;
    // this.utmSource = utmSource;
    // this.utmTerm = utmTerm;
  }
}
