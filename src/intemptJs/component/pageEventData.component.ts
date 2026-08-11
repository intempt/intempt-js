import { BaseURLParser } from '../_baseUrlParser.ts';

export class PageEventDataComponent {
  private readonly previousPage: string;
  private readonly windowWidth: number;
  private readonly timeOnPage?: number;
  private readonly domain: string;
  private readonly query: string;
  private readonly title: string;
  private readonly path: string;
  private readonly hash: string;
  private readonly url: string;

  /**
   * The fields the page tracker reports, named instead of `any`. `duration` is
   * genuinely optional — a "View Page" has no elapsed time yet, only "Leave Page"
   * does — and that optionality is load-bearing below (`timeOnPage` stays
   * undefined rather than becoming 0).
   */
  constructor({
    duration,
    title,
    fullUrl,
    windowWidth,
    previousPage,
  }: {
    duration?: number;
    title: string;
    fullUrl: string;
    windowWidth: number;
    previousPage: string;
  }) {
    const { query, urlHash, origin, pathname, domain } = new BaseURLParser(
      fullUrl,
    );

    this.previousPage = previousPage;
    this.windowWidth = windowWidth;
    this.timeOnPage = !!duration ? Math.round(duration / 1000) : duration;
    this.domain = domain;
    this.title = title;
    this.query = query;
    this.hash = urlHash;
    this.path = pathname;
    this.url = fullUrl;
  }
}
