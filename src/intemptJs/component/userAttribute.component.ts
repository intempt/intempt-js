import { DeviceType, Location } from '../types/autoTracker.types.ts';
import { getCookie, setCookie } from '../../shared/storageHandler.ts';
import { BaseURLParser } from '../_baseUrlParser.ts';


export class UserAttributeComponent{
  deviceType:DeviceType;
  referrer:string;
  fullReferrer:string ;
  landingPage:string ;
  browser:string;
  platform:string;
  ipAddress:string;
  country:string;
  region:string;
  city:string;
  private readonly utmCampaign:string;
  private readonly utmContent:string;
  private readonly utmMedium:string;
  private readonly utmSource:string;
  private readonly utmTerm:string;


  constructor({ country, region, city, ip}:Location, utmParams: BaseURLParser, platform:string, _deviceType:DeviceType, _browser:string) {

    const { referrer, fullReferrer } = this._getReferrerValues();

    // this.deviceType = this._getDeviceType();
    this.deviceType = _deviceType;

    this.referrer = referrer;
    this.fullReferrer = fullReferrer;
    this.landingPage = this._getLandingPageUrl();

    // this.browser = this._getBrowser();
    this.browser = _browser;
    this.platform = platform
    this.country = country;
    this.region = region;
    this.city = city;
    this.ipAddress = ip;

    this.utmCampaign = utmParams.utmCampaign;
    this.utmContent = utmParams.utmContent;
    this.utmMedium = utmParams.utmMedium;
    this.utmSource = utmParams.utmSource;
    this.utmTerm = utmParams.utmTerm;

  }

  private _getLandingPageUrl(){
    const cookie = getCookie('_intempt_landing_page');

    if(cookie) {
      return cookie['_intempt_landing_page']
    }

    try{
      const url = new URL(document.location.href);

      setCookie({
        name: '_intempt_landing_page',
        value:  url.origin,
        path: '/',
      });

      return url.origin;
    }
    catch (error:any){
      console.log('[_getLandingPageUrl] ERROR',error);
      return ''
    }
  }

  private _getReferrerValues(){
    let referrer = 'direct';
    let fullReferrer = 'direct';

    const cookie = getCookie('_intempt_referrer');

    if(cookie) {
      const cookieObj = { ...JSON.parse(cookie['_intempt_referrer']) };
      return { referrer: cookieObj.referrer, fullReferrer: cookieObj.fullReferrer };
    }


    if (!document.referrer) {
      return { referrer, fullReferrer };
    }

    try{
      const url = new URL(document.referrer);
      referrer = url.host;
      fullReferrer = url.href;
    }
    catch (error:any){
      console.log('[_getReferrerValues] ERROR',error);
    }


    return { referrer, fullReferrer };
  }

}

