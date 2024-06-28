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

    // const location = await this._getLocation();
    //
    // const platform = await this._getPlatform();

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

  private async _handleUserAgentEntropyValue(defaultPlatform= "Unknown"){
    try {
      const highEntropyData = await navigator['userAgentData']?.getHighEntropyValues(["platformVersion", "platform"]);
      if (highEntropyData && highEntropyData?.platform && highEntropyData?.platformVersion) {
        const majorPlatformVersion = parseInt(highEntropyData.platformVersion.split('.')[0]);
        switch(navigator.userAgentData?.platform.toLowerCase()){
          case 'ios':
            if (majorPlatformVersion >= 17) {
              return `iOS 17 or later`;
            }
            else if (majorPlatformVersion >= 16) {
              return `iOS 16`;
            }
            else if (majorPlatformVersion >= 15) {
              return `iOS 15`;
            }
            else if (majorPlatformVersion >= 14) {
              return `iOS 14`;
            }
            else if (majorPlatformVersion >= 13) {
              return `iOS 13`;
            }
            else if (majorPlatformVersion >= 12) {
              return `iOS 12`;
            }
            else {
              return `iOS version earlier than 12`;
            }
          case 'windows':
            if (majorPlatformVersion >= 13) {
              return `Windows 11 or later`;
            }
            else if (majorPlatformVersion > 0) {
              return `Windows 10`;
            }
            else {
              return `${navigator.userAgentData?.platform} ${highEntropyData.platformVersion}`;

            }
          case 'macos':
            if (majorPlatformVersion >= 14) {
              console.log("macOS 14 Sonoma or later");
            }
            else if (majorPlatformVersion >= 13) {
              console.log("macOS 13 Ventura");
            }
            else if (majorPlatformVersion >= 12) {
              console.log("macOS 12 Monterey");
            }
            else if (majorPlatformVersion >= 11) {
              console.log("macOS 11 Big Sur");
            }
            else if (majorPlatformVersion >= 10) {
              console.log("macOS 10 Catalina or earlier");
            }
            else {
              console.log("Unknown macOS version");
            }
        }

      }



        //return this._getPlatformVersion(highEntropyData.platform, highEntropyData.platformVersion, defaultPlatform);

      return defaultPlatform;
    }
    catch (error:any) {
      console.error("Error fetching high entropy values:", error);
      return defaultPlatform;
    }
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



}

