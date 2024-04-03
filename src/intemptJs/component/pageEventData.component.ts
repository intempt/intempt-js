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

  constructor({duration, title, fullUrl, windowWidth, previousPage}:any) {
    const {
      query,
      urlHash,
      origin,
      pathname
    } = new BaseURLParser(fullUrl);

    this.previousPage = previousPage;
    this.windowWidth = windowWidth;
    this.timeOnPage = duration;
    this.domain = origin;
    this.title = title;
    this.query = query;
    this.hash = urlHash;
    this.path = pathname;
    this.url = fullUrl;
  }


}
