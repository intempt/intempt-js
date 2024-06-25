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

    const userAgent = navigator.userAgent ;

    // Regex patterns to detect mobile and tablet devices
    const mobileRegex = /Mobile|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Windows Phone/i;
    const tabletRegex = /Tablet|iPad/i;

    if (mobileRegex.test(userAgent)) {
      return 'Mobile';
    } else if (tabletRegex.test(userAgent)) {
      return 'Tablet';
    } else if (screenWidth <= mobileMaxScreenWidth) {
      return 'Mobile';
    } else if (screenWidth <= tabletMaxScreenWidth) {
      return 'Tablet';
    } else {
      return 'Desktop';
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
    const userAgent = navigator.userAgent;
    const defaultBrowser = "Unknown";

    const browserVersion = (userAgent: string,regex:RegExp) => {
      const match = userAgent.match(regex);
      return match && match.length > 2 ? match[2] : null;
    }

    const browsers = [
      {
        name: 'Edge',
        regex: /edg/i,
        result: (userAgent: string) => `Edge/${browserVersion(userAgent, /(edge|edga|edgios|edg)\/([\d\.]+)/i)}`
      },
      {
        name: 'UCBrowser',
        regex: /ucbrowser/i,
        result: (userAgent: string) => `UCBrowser/${browserVersion(userAgent, /(ucbrowser)\/([\d\.]+)/i)}`
      },
      {
        name: 'GoogleBot',
        regex: /googlebot/i,
        result: (userAgent: string) => `GoogleBot/${browserVersion(userAgent, /(googlebot)\/([\d\.]+)/i)}`
      },
      {
        name: 'Chromium',
        regex: /chromium/i,
        result: (userAgent: string) => `Chromium/${browserVersion(userAgent, /(chromium)\/([\d\.]+)/i)}`
      },
      {
        name: 'Firefox',
        regex: /firefox|fxios/i,
        exclude: /seamonkey/i,
        result: (userAgent: string) => `Firefox/${browserVersion(userAgent, /(firefox|fxios)\/([\d\.]+)/i)}`
      },
      {
        name: 'IE',
        regex: /; msie|trident/i,
        exclude: /ucbrowser/i,
        result: (userAgent: string) => {
          const version = browserVersion(userAgent, /trident\/([\d\.]+)/i);
          // IE version is mapped using trident version
          // IE/8.0 = Trident/4.0, IE/9.0 = Trident/5.0, etc.
          return `IE/${version ? `${parseFloat(version) + 4.0}` : version}`;
        }
      },
      {
        name: 'Chrome',
        regex: /chrome|crios/i,
        exclude: /opr|opera|chromium|edg|ucbrowser|googlebot/i,
        result: (userAgent: string) => `Chrome/${browserVersion(userAgent, /(chrome|crios)\/([\d\.]+)/i)}`
      },
      {
        name: 'Safari',
        regex: /safari/i,
        exclude: /chromium|edg|ucbrowser|chrome|crios|opr|opera|fxios|firefox/i,
        result: (userAgent: string) => `Safari/${browserVersion(userAgent, /version\/([\d\.]+).*safari/i)}`
      },
      {
        name: 'Opera',
        regex: /opr|opera/i,
        result: (userAgent: string) => `Opera/${browserVersion(userAgent, /(opera|opr)\/([\d\.]+)/i)}`
      }
    ];

    for (const { regex, exclude, result } of browsers) {
      if (regex.test(userAgent) && (!exclude || !exclude.test(userAgent))) {
        return result(userAgent);
      }
    }

    return `${defaultBrowser}/0.0.0.0`;


    // let browser = defaultBrowser;
    // // Detect browser name
    // browser = (/edg/i).test(userAgent) ? 'Edge' : browser;
    // browser = (/ucbrowser/i).test(userAgent) ? 'UCBrowser' : browser;
    //
    // browser = (/googlebot/i).test(userAgent) ? 'GoogleBot' : browser;
    // browser = (/chromium/i).test(userAgent) ? 'Chromium' : browser;
    // browser = (/firefox|fxios/i).test(userAgent) && !(/seamonkey/i).test(userAgent) ? 'Firefox' : browser;
    // browser = (/; msie|trident/i).test(userAgent) && !(/ucbrowser/i).test(userAgent) ? 'IE' : browser;
    // browser = (/chrome|crios/i).test(userAgent) && !(/opr|opera|chromium|edg|ucbrowser|googlebot/i).test(userAgent) ? 'Chrome' : browser;
    // browser = (/safari/i).test(userAgent) && !(/chromium|edg|ucbrowser|chrome|crios|opr|opera|fxios|firefox/i).test(userAgent) ? 'Safari' : browser;
    // browser = (/opr|opera/i).test(userAgent) ? 'Opera' : browser;
    //
    // // detect browser version
    // switch (browser) {
    //   case 'UCBrowser': return `${browser}/${browserVersion(userAgent,/(ucbrowser)\/([\d\.]+)/i)}`;
    //   case 'Edge': return `${browser}/${browserVersion(userAgent,/(edge|edga|edgios|edg)\/([\d\.]+)/i)}`;
    //   case 'GoogleBot': return `${browser}/${browserVersion(userAgent,/(googlebot)\/([\d\.]+)/i)}`;
    //   case 'Chromium': return `${browser}/${browserVersion(userAgent,/(chromium)\/([\d\.]+)/i)}`;
    //   case 'Firefox': return `${browser}/${browserVersion(userAgent,/(firefox|fxios)\/([\d\.]+)/i)}`;
    //   case 'Chrome': return `${browser}/${browserVersion(userAgent,/(chrome|crios)\/([\d\.]+)/i)}`;
    //   case 'Safari': return `${browser}/${browserVersion(userAgent,/(safari)\/([\d\.]+)/i)}`;
    //   case 'Opera': return `${browser}/${browserVersion(userAgent,/(opera|opr)\/([\d\.]+)/i)}`;
    //
    //   case 'IE': const version = browserVersion(userAgent,/(trident)\/([\d\.]+)/i);
    //     return version ? `${browser}/${parseFloat(version) + 4.0}` : `${browser}/7.0`;
    //   default: return `${defaultBrowser}/0.0.0.0`;
    // }
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

