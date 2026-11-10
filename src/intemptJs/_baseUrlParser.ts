import { UtmKeys } from './types/autoTracker.types.ts';
import { UtmKey } from './types/constants.types.ts';

export class BaseURLParser {
  readonly query: string = undefined!;
  readonly origin: string = undefined!;
  readonly pathname: string = undefined!;
  readonly utmTerm: string = undefined!;
  readonly urlHash: string = undefined!;
  readonly utmSource: string = undefined!;
  readonly utmMedium: string = undefined!;
  readonly utmContent: string = undefined!;
  readonly utmCampaign: string = undefined!;
  readonly domain: string = undefined!;

  constructor(urlProperty?: string) {
    const url = urlProperty || window.location.href;

    const urlObject = new URL(url);
    const searchParams = new URLSearchParams(urlObject.search);
    const { utm_campaign, utm_content, utm_medium, utm_source, utm_term } =
      this.getUtmProperties(searchParams);

    this.query = urlObject.search || '';
    this.urlHash = urlObject.hash || '';
    this.utmCampaign = utm_campaign;
    this.utmContent = utm_content;
    this.utmMedium = utm_medium;
    this.utmSource = utm_source;
    this.utmTerm = utm_term;

    this.origin = urlObject.origin;
    this.pathname = urlObject.pathname;
    this.domain = urlObject.hostname;
  }

  private getUtmProperties(
    searchParams: URLSearchParams,
  ): Record<UtmKeys, string> {
    const utmKeys: UtmKeys[] = Object.values(UtmKey);
    // The seed is cast rather than typed `Partial`: the fold visits every `UtmKey`,
    // so the result really is total, and a `Partial` return would push a bogus
    // `| undefined` onto all five call sites.
    return utmKeys.reduce(
      (acc: Record<UtmKeys, string>, key: UtmKeys) => ({
        ...acc,
        [key]: searchParams.get(key) || '',
      }),
      {} as Record<UtmKeys, string>,
    );
  }
}
