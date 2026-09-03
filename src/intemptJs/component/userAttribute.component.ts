import { DeviceType } from '../types/autoTracker.types.ts';
import { getCookie, setCookie } from '../../shared/storageHandler.ts';
import { BaseURLParser } from '../_baseUrlParser.ts';

import { createLogger } from '../../shared/logger/logger.ts';

const log = createLogger('UserAttribute');

export class UserAttributeComponent {
  deviceType: DeviceType;
  referrer: string;
  fullReferrer: string;
  landingPage: string;
  browser: string;
  platform: string;
  private readonly utmCampaign: string;
  private readonly utmContent: string;
  private readonly utmMedium: string;
  private readonly utmSource: string;
  private readonly utmTerm: string;

  /**
   * Geo is not here on purpose. `country`, `region`, `city` and `ipAddress` used to be set from a
   * per-session call to ipapi.co, which disclosed every visitor's address to a service the customer
   * never contracted with. Intempt now derives country, region and city server-side from the
   * connection the request already arrives on, so the browser never handles its own address.
   *
   * The `useIpAddressForGeolocation` option controls that derivation (see its TSDoc on
   * `IntemptConfig` and `sdkLoader.ts`) — this class has no HTTP or config access, so it
   * isn't where that switch is set.
   */
  constructor(
    utmParams: BaseURLParser,
    platform: string,
    _deviceType: DeviceType,
    _browser: string,
  ) {
    const { referrer, fullReferrer } = this._getReferrerValues();

    this.deviceType = _deviceType;

    this.referrer = referrer;
    this.fullReferrer = fullReferrer;
    this.landingPage = this._getLandingPageUrl();

    this.browser = _browser;
    this.platform = platform;

    this.utmCampaign = utmParams.utmCampaign;
    this.utmContent = utmParams.utmContent;
    this.utmMedium = utmParams.utmMedium;
    this.utmSource = utmParams.utmSource;
    this.utmTerm = utmParams.utmTerm;
  }

  private _getLandingPageUrl() {
    const cookie = getCookie('_intempt_landing_page');

    if (cookie) {
      return cookie['_intempt_landing_page'];
    }

    try {
      const url = new URL(document.location.href);

      setCookie({
        name: '_intempt_landing_page',
        value: url.origin,
        path: '/',
      });

      return url.origin;
    } catch (error: unknown) {
      log.warn('_getLandingPageUrl failed', error);
      return '';
    }
  }

  private _getReferrerValues() {
    let referrer = 'direct';
    let fullReferrer = 'direct';

    const cookie = getCookie('_intempt_referrer');

    if (cookie) {
      const cookieObj = { ...JSON.parse(cookie['_intempt_referrer']) };
      return {
        referrer: cookieObj.referrer,
        fullReferrer: cookieObj.fullReferrer,
      };
    }

    if (!document.referrer) {
      return { referrer, fullReferrer };
    }

    try {
      const url = new URL(document.referrer);
      referrer = url.host;
      fullReferrer = url.href;
    } catch (error: unknown) {
      log.warn('_getReferrerValues failed', error);
    }

    return { referrer, fullReferrer };
  }
}
