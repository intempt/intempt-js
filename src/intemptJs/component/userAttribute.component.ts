import { DeviceType,Location } from '../types/autoTracker.types.ts';


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

    const {referrer, fullReferrer} = this._getReferrerValues();

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

      if(!isMobileOrTablet) return 'Desktop'
      else{

        const isMobile = mobileMaxScreenWidth >= screenWidth;

        return isMobile ? 'Mobile' : 'Tablet'
      }
    }
  }

  private _getLandingPageUrl(){
    const url = new URL(document.location.href);
    return url.origin
  }

  private _getReferrerValues(){
    let referrer = '';
    let fullReferrer = '';

    if (!document.referrer) {
      return { referrer, fullReferrer };
    }

    try{
      const url = new URL(document.referrer);
      referrer = url.origin;
      fullReferrer = url.href;
    }
    catch (error:any){
      referrer = '';
      fullReferrer = '';
      console.log(error);
    }

    return { referrer, fullReferrer };

  }

  private _getBrowser(){
    if (!navigator.userAgent) {
      return "Unknown";
    }

    const currentUserAgent = navigator.userAgent.toLowerCase();
    const browserRegexes:{[key:string]: RegExp} = {
      edge: /edge\/(\d+(\.\d+)?)/,
      chrome: /(chrome|crios|crmo)\/(\d+(\.\d+)?)/,
      firefox: /firefox\/(\d+(\.\d+)?)/,
      safari: /version\/(\d+(\.\d+)?)/,
      msie: /(msie |rv:)(\d+(\.\d+)?)/,
      opera: /(opera|opr)\/(\d+(\.\d+)?)/,
      android: /version\/(\d+(\.\d+)?)/
    };

    for (const key in browserRegexes) {
      if (browserRegexes.hasOwnProperty(key)) {
        const match = currentUserAgent.match(browserRegexes[key]);

        if (match) {
          const name = match[1].charAt(0).toUpperCase() + match[1].slice(1)
          const version = match[2]
          return `${ name } ${version }`
        }

      }
    }

     const match = currentUserAgent.match(/^(.*)\/(.*) /);
     const name = match ?match[1].charAt(0).toUpperCase() + match[1].slice(1) : "Unknown";
     const version = match ? match[2] : "";


    return `${ name } ${version}`;
  }

  private _getPlatform(){
    if (!navigator.userAgent) {
      return "Unknown";
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
            version = match[1].replace(/_/g, '.'); // Replace underscores with dots for version format consistency
          }
          return `${key.charAt(0).toUpperCase() + key.slice(1)} ${version}`;
        }
      }
    }

    return "Unknown";
  }



}
