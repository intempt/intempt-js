import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, localIntemptSessionCookie, setCookie } from '../../../../../shared/storageHandler.ts';
import { LocationApi, SessionCookie, SessionCookieObject } from '../../../../types/autoTracker.types.ts';
import { SessionEventDataComponent } from '../../../../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../../../../component/userAttribute.component.ts';
import { BaseURLParser } from '../../../../_baseUrlParser.ts';

export class SessionTrackerModule {
  private readonly idType = 'ses';
  private readonly _eventName = 'Session start';

  private readonly intemptSession = 'intempt_session';
  private readonly keys = [this.intemptSession];



  private readonly millisecondsPerSecond  = 1000;
  private readonly secondsPerMinute  = 60;
  private readonly minutesStep  = 30;

  private readonly _defaultSessionTimeWithoutActivity = this.minutesStep * this.secondsPerMinute * this.millisecondsPerSecond;

  private readonly _foregroundEventNames = [
    'intempt:html',
    'intempt:page',
    'intempt:identify',
  ];
  private readonly _backgroundEventNames = [
    'intempt:track',
    'intempt:group',
    'intempt:track',
    'intempt:record',
    'intempt:alias',
    'intempt:logOut',
    'intempt:consent',
  ];
  private _allTrackingEvents = [...this._foregroundEventNames, ...this._backgroundEventNames]


  constructor() {
   this._sessionActivityHandler();
  }

  get cookieKeys() { return this.keys; }

  getId(){
    const cookie = getCookie(this.intemptSession) as {intempt_session : string} | null;
    const { id } = !!cookie
      ? { ...JSON.parse(cookie[this.intemptSession]) } as {id: string}
      : {id: ''};

    return id
  }

  getLocalId(){
    const localCookie = localIntemptSessionCookie();
    return localCookie?.id ?? '' ;
  }

  clearCookies(cookieNames:string[]){
    cookieNames.forEach(
      (cookieName) => setCookie({
        name: cookieName,
        value: '',
        path: '/',
        expiration: -1
      })
    )
  }

  private _sessionActivityHandler(){
    this._allTrackingEvents.forEach( (domEventName) => {
      document.addEventListener(domEventName, (event) => {
        const { detail } = event as CustomEvent;
        const { eventName } = detail;

        const sessionCookie = getCookie(this.intemptSession) as SessionCookie;

        if (!sessionCookie && eventName.toLowerCase() !== 'leave page') {
          return this._onNewSession(eventName);
        }

        if(domEventName === 'intempt:logOut') {
          return this.clearCookies(eventName);
        }

        const session = { ...JSON.parse(sessionCookie[this.intemptSession]) } as SessionCookieObject;

        setCookie({
          name: this.intemptSession,
          value: JSON.stringify({
            id: session.id,
          }),
          path: '/',
          expiration: this._defaultSessionTimeWithoutActivity,
        });
      })
    })
  }

  private async _getLocation():Promise<LocationApi>{
    const locationApiUrl = import.meta.env.VITE_LOCATION_API_URL

    try {
      const response = await fetch(locationApiUrl);
      const data = await response.json()
      const {ip, region, city, country_name } = data
      return {
        ip: ip ?? '',
        region: region ?? '',
        city: city ?? '',
        country: country_name ?? '',
      }
    } catch (error) {
      console.log('Fetching location not allowed');
      return {
        ip: '',
        region: '',
        city: '',
        country: '',
      }
    }
  }

  /**
   * Runs when a new session should be created
   * */
  private async _onNewSession(initializerEventName:string = this._eventName){
    setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: generateId(this.idType),
      }),
      path: '/',
      expiration: this._defaultSessionTimeWithoutActivity,
    });

    const [location, platform] = await Promise.all([this._getLocation(), this._getPlatform()]);

    const urlParams = new BaseURLParser();

    const eventAttributes = new SessionEventDataComponent({
      sessionStartEventName: initializerEventName,
      query: urlParams.query,
      urlHash: urlParams.urlHash,
    });

    const userAttributes = new UserAttributeComponent(location, urlParams, platform);


    dispatchIntemptEvent('intempt:session', {
      eventName: this._eventName,
      eventAttributes,
      userAttributes,
      type: 'sessionStart',
    });
  }

  private async _getPlatform(){
    const defaultPlatform = "Unknown";
    if (navigator.userAgentData) {
      return this._handleUserAgentEntropyValue(defaultPlatform);
    }
    else if (!navigator.userAgent) {
      return defaultPlatform;
    }

    return this._handleUserAgent();

  }

  private _handleUserAgent(defaultPlatform= "Unknown"){
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
            version = match[1].replace(/_/g, '.');
          }

          return this._getPlatformVersion(key, version, defaultPlatform);
        }
      }
    }

    return defaultPlatform;
  }

  private _getPlatformVersion(platformKey:string, version:string, defaultPlatform='Unknown'){
    switch (platformKey.toLowerCase()) {
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


  private async _handleUserAgentEntropyValue(defaultPlatform= "Unknown"){
    try {
      const highEntropyData = await navigator['userAgentData']?.getHighEntropyValues(["platformVersion", "platform"]);
      if (highEntropyData && highEntropyData?.platform && highEntropyData?.platformVersion) {
        switch(navigator.userAgentData?.platform.toLowerCase()){
          case 'macos':
            return this._macosCase(highEntropyData.platformVersion);
          case 'ios':
            return this._iosCase(highEntropyData.platformVersion);
          case 'windows':
            return this._windowsCase(highEntropyData.platformVersion);
          case 'linux':
            return this._linuxCase(highEntropyData.platformVersion)
          case 'android':
            return this._androidCase(highEntropyData.platformVersion);
        }

      }

//0246d85af79e4be8b50b70d46141a07c.39a62c03490b4c31a51769055fe266e8

        //return this._getPlatformVersion(highEntropyData.platform, highEntropyData.platformVersion, defaultPlatform);

      return defaultPlatform;
    }
    catch (error:any) {
      console.error("Error fetching high entropy values:", error);
      return defaultPlatform;
    }
  }

  private _iosCase(version:string){
    return `iOS ${version}`;
  }

  private _macosCase(version:string){
    const [platformVersion] = version.split('.');
    const majorPlatformVersion = parseInt(platformVersion);

    if (majorPlatformVersion >= 14) {
      return `macOS 14 Sonoma or later`;
    }
    else if (majorPlatformVersion >= 13) {
      return `macOS 13 Ventura`;
    }
    else if (majorPlatformVersion >= 12) {
      return `macOS 12 Monterey`;
    }
    else if (majorPlatformVersion >= 11) {
      return `macOS 11 Big Sur`;
    }
    else if (majorPlatformVersion >= 10) {
      return `macOS 10 Catalina or earlier`;
    }
    else {
      return 'Unknown macOS version';
    }


  }

  private _windowsCase(version:string){
    const [platformVersion] = version.split('.');
    const majorPlatformVersion = parseInt(platformVersion);

    if (majorPlatformVersion >= 13) {
      return `Windows 11`;
    }
    else if (majorPlatformVersion === 10) {
      return `Windows 10`;
    }
    else if (majorPlatformVersion === 6 && version.includes('1')) {
      return `Windows 7`;
    }
    else if (majorPlatformVersion === 6 && version.includes('0')) {
      return `Windows Vista`;
    }
    else if (majorPlatformVersion === 5 && version.includes('1')){
      return `Windows XP`;
    }
    else {
      return `Windows ${version}`;
    }

  }

  private _linuxCase(version:string){
    const [platformVersion] = version.split('.');

    if (version.includes("ubuntu")) {
      return `Ubuntu ${platformVersion}`;
    }
    else if (platformVersion.includes("fedora")) {
      return `Fedora ${platformVersion}`;
    }
    else if (platformVersion.includes("debian")) {
      return `Debian ${platformVersion}`;
    }
    else if (platformVersion.includes("arch")) {
      return `Arch Linux ${platformVersion}`;
    }
    else {
      return `Linux ${platformVersion}`;
    }
  }

  private _androidCase(version:string){
    const [platformVersion] = version.split('.');
    const majorPlatformVersion = parseInt(platformVersion);


    if (majorPlatformVersion >= 14) {
      return `Android 14 or later`;
    }
    else if (majorPlatformVersion >= 13) {
      return `Android 13`;
    }
    else if (majorPlatformVersion === 12) {
      return `Android 12`;
    }
    else if (majorPlatformVersion === 11) {
      return `Android 11`;
    }
    else if (majorPlatformVersion === 10) {
      return `Android 10`;
    }
    else if (majorPlatformVersion === 9) {
      return `Android 9 Pie`;
    }
    else if (majorPlatformVersion === 8) {
      return `Android 8 Oreo`;
    }
    else if (majorPlatformVersion === 7) {
      return `Android 7 Nougat`;
    }
    else if (majorPlatformVersion === 6) {
      return `Android 6 Marshmallow`;
    }
    else if (majorPlatformVersion === 5) {
      return `Android 5 Lollipop`;
    } else {
      return `Android version earlier than 5`;
    }



  }

}

