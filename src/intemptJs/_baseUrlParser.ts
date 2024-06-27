import { UtmKeys } from './types/autoTracker.types.ts';


export class BaseURLParser {
   readonly query :string;
   readonly origin :string;
   readonly pathname :string;
   readonly utmTerm :string;
   readonly urlHash :string;
   readonly utmSource :string;
   readonly utmMedium :string;
   readonly utmContent :string;
   readonly utmCampaign :string;
   readonly domain :string;

  constructor(urlProperty?:string){
    const url = urlProperty || window.location.href;

    const urlObject = new URL(url);
    const searchParams = new URLSearchParams(urlObject.search);
    const {utm_campaign, utm_content, utm_medium, utm_source, utm_term} = this.getUtmProperties(searchParams);

    this.query = urlObject.search || '';
    this.urlHash = urlObject.hash || '';
    this.utmCampaign = utm_campaign
    this.utmContent = utm_content
    this.utmMedium = utm_medium
    this.utmSource = utm_source
    this.utmTerm = utm_term

    this.origin = urlObject.origin;
    this.pathname = urlObject.pathname;
    this.domain = urlObject.hostname;
  }


 private getUtmProperties(searchParams:URLSearchParams){
    const utmKeys:UtmKeys[] = ['utm_campaign','utm_content','utm_medium','utm_source','utm_term'];
    return utmKeys.reduce((acc:any,key:UtmKeys)=>({
      ...acc,
      [key]:searchParams.get(key) || ''
    }), {})
 }
}
