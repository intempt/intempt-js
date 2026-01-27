import { DeviceType, LocationApi } from './types/autoTracker.types.ts';
import { DeviceTypeName } from './types/constants.types.ts';
import { EnvConfig } from '../shared/envConfig.ts';

export class PlatformParser {
  defaultPlatform = "Unknown";
  defaultBrowser = "Unknown";

  private readonly _deviceType:DeviceType = DeviceTypeName.DEFAULT;
  private readonly _browser:string = 'Unknown';

  private readonly _platformVersions:Record<string, (version:string)=> string> = {
    windows: (version:string) => `Windows ${version}`,
    android: (version:string) => `Android ${version}`,
    mac: (version:string) => `Mac OS X ${version.split('_').join('.')}`,
    linux: (version:string) => `Linux`,
    ios: (version:string) => {
      const versionParts = version.split('.');

      const majorVersion = versionParts[0];
      const minorVersion = versionParts[1] || '0';
      return `iOS ${majorVersion}.${minorVersion}`;
    },
  };

  private readonly osRegexes:Record<string, RegExp> = {
    windows: /windows nt (\d+\.\d+)/,
    android: /android (\d+(\.\d+)?)/,
    ios: /(iphone|ipad|ipod).*os (\d+_?\d+_?\d*)/,
    mac: /mac os x (\d+(_\d+)*)/,
    linux: /linux/,
  };

  constructor(){
    this._deviceType = this.detectDeviceType();
    this._browser = this._getBrowser();
  }


  get _userAgent(){
    return navigator.userAgent.toLowerCase();
  }

  get deviceType(){
    return this._deviceType;
  }

  get browser(){
    return this._browser;
  }


  private detectDeviceType(): DeviceType{
    const ua = this._userAgent;
    const mobileMaxScreenWidth = 480;
    const tabletMaxScreenWidth = 1024;
    const tabletRegex =/(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|(puffin(?!.*(IP|AP|WP))))/;
    const mobileRegex = /(mobi|ipod|phone|blackberry|opera mini|fennec|minimo|symbian|psp|nintendo ds|archos|skyfire|puffin|blazer|bolt|gobrowser|iris|maemo|semc|teashark|uzard)/;

    //TODO: Regex for detecting tablet or phone based on user agent
    const isTablet = tabletRegex.test(ua);
    const isPhone = mobileRegex.test(ua);

    // Check for touch capability and screen size
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const screenWidth = window.screen.width;

    // Define thresholds for mobile/tablet detection based on screen size
    const isSmallScreen = screenWidth <= mobileMaxScreenWidth;
    const isMediumScreen = screenWidth > mobileMaxScreenWidth && screenWidth <= tabletMaxScreenWidth;

    if (isTablet || (isTouchDevice && isMediumScreen)) {
      return DeviceTypeName.TABLET;
    } else if (isPhone || (isTouchDevice && isSmallScreen)) {
      return DeviceTypeName.MOBILE;
    } else {
      return DeviceTypeName.DESKTOP;
    }
  }


  protected _handleUserAgent(){
    for (const key in this.osRegexes) {
        const match = this._userAgent.match(this.osRegexes[key]);

        if (match) {
          let version = "";
          if (match.length > 1) {
            switch (key) {
              case 'mac':
              case 'android':
                version = match[1]
                break;

              case 'ios':
                version = match[match.length - 1].replace(/_/g, '.');
                break;

              default:
                version = match[match.length - 1];
                break;
            }
          }

          if(this._platformVersions.hasOwnProperty(key)){
            const platform = this._platformVersions[key];
            return platform(version);
          }
        }
    }

    return this.defaultPlatform
  }

  protected _getBrowser() {
    const browserVersion = (regex:RegExp) => {
      const match = this._userAgent.match(regex);
      return match && match.length > 2 ? match[2] : null;
    }

    const browsers = [
      {
        name: 'Edge',
        regex: /edg/i,
        result: () => `Edge/${browserVersion( /(edge|edga|edgios|edg)\/([\d\.]+)/i)}`
      },
      {
        name: 'UCBrowser',
        regex: /ucbrowser/i,
        result: () => `UCBrowser/${browserVersion( /(ucbrowser)\/([\d\.]+)/i)}`
      },
      {
        name: 'GoogleBot',
        regex: /googlebot/i,
        result: () => `GoogleBot/${browserVersion( /(googlebot)\/([\d\.]+)/i)}`
      },
      {
        name: 'Chromium',
        regex: /chromium/i,
        result: () => `Chromium/${browserVersion( /(chromium)\/([\d\.]+)/i)}`
      },
      {
        name: 'Firefox',
        regex: /firefox|fxios/i,
        exclude: /seamonkey/i,
        result: () => `Firefox/${browserVersion( /(firefox|fxios)\/([\d\.]+)/i)}`
      },
      {
        name: 'IE',
        regex: /; msie|trident/i,
        exclude: /ucbrowser/i,
        result: () => {
          const version = browserVersion( /trident\/([\d\.]+)/i);
          return `IE/${version ? `${parseFloat(version) + 4.0}` : version}`;
        }
      },
      {
        name: 'Chrome',
        regex: /chrome|crios/i,
        exclude: /opr|opera|chromium|edg|ucbrowser|googlebot/i,
        result: () => `Chrome/${browserVersion( /(chrome|crios)\/([\d\.]+)/i)}`
      },
      {
        name: 'Safari',
        regex: /safari/i,
        exclude: /chromium|edg|ucbrowser|chrome|crios|opr|opera|fxios|firefox/i,
        result: () => `Safari/${browserVersion( /version\/([\d\.]+).*safari/i)}`
      },
      {
        name: 'Opera',
        regex: /opr|opera/i,
        result: () => `Opera/${browserVersion( /(opera|opr)\/([\d\.]+)/i)}`
      }
    ];

    for (const { regex, exclude, result } of browsers) {
      if (regex.test(this._userAgent) && (!exclude || !exclude.test(this._userAgent))) {
        return result();
      }
    }

    return `${this.defaultBrowser}/0.0.0.0`;
  }

  protected async _handleUserAgentEntropyValue(){
    const _iosCase = (platformVersion:string) => {
      const versionParts = platformVersion.split('.');

      const majorVersion = versionParts[0];
      const minorVersion = versionParts[1] || '0';
      return `iOS ${majorVersion}.${minorVersion}`;
    }

    const _macosCase = (version:string) => {
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

    const _windowsCase = (version:string) => {
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

    const _linuxCase = (version:string) => {
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

    const _androidCase = (version:string) => {
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


    try {
      const highEntropyData = await navigator['userAgentData']?.getHighEntropyValues(["platformVersion", "platform"]);
      if (highEntropyData && highEntropyData?.platform && highEntropyData?.platformVersion) {
        switch(navigator.userAgentData?.platform.toLowerCase()){
          case 'macos':
            return _macosCase(highEntropyData.platformVersion);
          case 'ios':
            return _iosCase(highEntropyData.platformVersion);
          case 'windows':
            return _windowsCase(highEntropyData.platformVersion);
          case 'linux':
            return _linuxCase(highEntropyData.platformVersion)
          case 'android':
            return _androidCase(highEntropyData.platformVersion);
        }

      }

      return this.defaultPlatform;
    }
    catch (error:any) {
      return this.defaultPlatform;
    }
  }

  protected async _getLocation():Promise<LocationApi>{
    const locationApiUrl = EnvConfig.getLocationApiUrl();

    if (!locationApiUrl) {
      return {
        ip: '',
        region: '',
        city: '',
        country: '',
      };
    }

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
      return {
        ip: '',
        region: '',
        city: '',
        country: '',
      }
    }
  }

  protected async _getPlatform(){

    if (navigator.userAgentData) {
      return this._handleUserAgentEntropyValue();
    }
    else if (!navigator.userAgent) {
      return this.defaultPlatform;
    }

    return this._handleUserAgent();

  }


}
