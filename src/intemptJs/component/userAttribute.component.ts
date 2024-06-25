import { DeviceType, Location } from '../types/autoTracker.types.ts';
import { getCookie, setCookie } from '../../shared/storageHandler.ts';


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


  constructor({ country, region, city, ip}:Location) {

    const { referrer, fullReferrer } = this._getReferrerValues();

    this.deviceType = this._getDeviceType();

    this.referrer = referrer;
    this.fullReferrer = fullReferrer;
    this.landingPage = this._getLandingPageUrl();

    this.browser = this._getBrowser();
    this.platform = this._getPlatform();
    this.country = country;
    this.region = region;
    this.city = city;
    this.ipAddress = ip;

  }



  private _getDeviceType():DeviceType {
    const screenWidth = window.innerWidth;
    const mobileMaxScreenWidth = 480;
    const tabletMaxScreenWidth = 1024;

    if(!navigator.userAgent){
      if (screenWidth <= mobileMaxScreenWidth) return 'Mobile';
      else if (screenWidth <= tabletMaxScreenWidth) return 'Tablet';
      else return 'Desktop';

    }
    else{
      const currentUserAgent = navigator.userAgent.toLowerCase();
      const tabletMobileUserAgentStrings = [
        "Mozilla/5.0 (Android; Mobile; rv:13.0) Gecko/13.0 Firefox/13.0",
        "Mozilla/5.0 (Linux; U; Android 4.0.3; de-ch; HTC Sensation Build/IML74K) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30",
        "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/33.0.1750.117 Mobile Safari/537.36 OPR/20.0.1396.72047",
        "Opera/9.80 (Android 2.3.3; Linux; Opera Mobi/ADR-1111101157; U; es-ES) Presto/2.9.201 Version/11.50",
        "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Mobile Safari/537.36 Edge/16.16299"
      ];
      const isMobileOrTablet = tabletMobileUserAgentStrings.some(ua => currentUserAgent.includes(ua.toLowerCase()));

      if(!isMobileOrTablet) return 'Desktop';
      else{

        const isMobile = mobileMaxScreenWidth >= screenWidth;

        return isMobile ? 'Mobile' : 'Tablet'
      }
    }
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

    // const url = new URL(document.location.href);
    //
    // setCookie({
    //   name: '_intempt_landing_page',
    //   value:  url.origin,
    //   path: '/',
    // });
    //
    //
    //
    // return url.origin;
  }

  private _getReferrerValues(){
    let referrer = '';
    let fullReferrer = '';

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

      setCookie({
        name: '_intempt_referrer',
        value: JSON.stringify({ referrer, fullReferrer }),
        path: '/',
      });
    }
    catch (error:any){
      console.log('[_getReferrerValues] ERROR',error);
    }


    return { referrer, fullReferrer };
  }

  private _getBrowser() {
    const defaultBrowser = "Unknown";

    const browserVersion = (userAgent: string,regex:RegExp) => {
      const match = userAgent.match(regex);
      return match && match.length > 2 ? match[2] : null;
    }
    const userAgent = navigator.userAgent;
    let browser = defaultBrowser;
    // Detect browser name
    browser = (/ucbrowser/i).test(userAgent) ? 'UCBrowser' : browser;
    browser = (/edg/i).test(userAgent) ? 'Edge' : browser;
    browser = (/googlebot/i).test(userAgent) ? 'GoogleBot' : browser;
    browser = (/chromium/i).test(userAgent) ? 'Chromium' : browser;
    browser = (/firefox|fxios/i).test(userAgent) && !(/seamonkey/i).test(userAgent) ? 'Firefox' : browser;
    browser = (/; msie|trident/i).test(userAgent) && !(/ucbrowser/i).test(userAgent) ? 'IE' : browser;
    browser = (/chrome|crios/i).test(userAgent) && !(/opr|opera|chromium|edg|ucbrowser|googlebot/i).test(userAgent) ? 'Chrome' : browser;
    browser = (/safari/i).test(userAgent) && !(/chromium|edg|ucbrowser|chrome|crios|opr|opera|fxios|firefox/i).test(userAgent) ? 'Safari' : browser;
    browser = (/opr|opera/i).test(userAgent) ? 'Opera' : browser;

    // detect browser version
    switch (browser) {
      case 'UCBrowser': return `${browser}/${browserVersion(userAgent,/(ucbrowser)\/([\d\.]+)/i)}`;
      case 'Edge': return `${browser}/${browserVersion(userAgent,/(edge|edga|edgios|edg)\/([\d\.]+)/i)}`;
      case 'GoogleBot': return `${browser}/${browserVersion(userAgent,/(googlebot)\/([\d\.]+)/i)}`;
      case 'Chromium': return `${browser}/${browserVersion(userAgent,/(chromium)\/([\d\.]+)/i)}`;
      case 'Firefox': return `${browser}/${browserVersion(userAgent,/(firefox|fxios)\/([\d\.]+)/i)}`;
      case 'Chrome': return `${browser}/${browserVersion(userAgent,/(chrome|crios)\/([\d\.]+)/i)}`;
      case 'Safari': return `${browser}/${browserVersion(userAgent,/(safari)\/([\d\.]+)/i)}`;
      case 'Opera': return `${browser}/${browserVersion(userAgent,/(opera|opr)\/([\d\.]+)/i)}`;
      case 'IE': const version = browserVersion(userAgent,/(trident)\/([\d\.]+)/i);
        // IE version is mapped using trident version
        // IE/8.0 = Trident/4.0, IE/9.0 = Trident/5.0
        return version ? `${browser}/${parseFloat(version) + 4.0}` : `${browser}/7.0`;
      default: return `${defaultBrowser}/0.0.0.0`;
    }
  }

  private _getPlatform(){

    const defaultPlatform = "Unknown";

    if (!navigator.userAgent) {
      return defaultPlatform;
    }
    const currentUserAgent = navigator.userAgent.toLowerCase();
    const osRegexes: { [key: string]: RegExp } = {
      windows: /windows nt (\d+\.\d+)/,
      android: /android (\d+\.\d+)/,
      ios: /(iphone|ipad|ipod) os (\d+_?\d+_?\d+)/,
      mac: /mac os x (\d+(_\d+)*)/,
      linux: /linux/,
    };

    for (const key in osRegexes) {
      if (osRegexes.hasOwnProperty(key)) {
        const match = currentUserAgent.match(osRegexes[key]);

        if (match) {
          let version = "";
          if (match.length > 1) {
            // Replace underscores with dots for version format consistency
            version = match[1].replace(/_/g, '.');
          }

          return this._getPlatformVersion(key, version, defaultPlatform);
        }
      }
    }

    return defaultPlatform;
  }

  private _getPlatformVersion(platformKey:string, version:string, defaultPlatform='Unknown'){
    switch (platformKey) {
      case 'windows':
        return `Windows ${version}`;
      case 'android':
        return `Android ${version}`;
      case 'ios':
        return `iOS ${version}`;
      case 'mac':
        return `Mac OS X ${version}`;
      case 'linux':
        return `Linux`;
      default:
        return defaultPlatform;
    }
  }


}

