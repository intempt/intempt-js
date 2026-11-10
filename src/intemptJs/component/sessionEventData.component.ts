type Props = {
  sessionStartEventName: string;
  eventCount?: number;
  sessionDuration?: number;
  query: string;
  urlHash: string;
};

export class SessionEventDataComponent {
  private readonly sessionStartEventName: string = undefined!;
  private readonly landingPageQuery: string = undefined!;
  private readonly landingPageHash: string = undefined!;
  private readonly source = 'web';

  constructor({ sessionStartEventName, query, urlHash }: Props) {
    this.sessionStartEventName = sessionStartEventName;
    this.landingPageQuery = query;
    this.landingPageHash = urlHash;
  }
}
