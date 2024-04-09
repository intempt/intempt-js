import { BaseURLParser } from '../src/intemptJs/_baseUrlParser';


describe('BaseURLParser', () => {
  it('should parse the url correctly', () =>{
    const url = 'https://www.intempt.com/test?utm_campaign=123&utm_content=456&utm_medium=789&utm_source=101112&utm_term=131415#hash';
    const baseUrlParser = new BaseURLParser(url);

    expect(baseUrlParser.query).to.eq('?utm_campaign=123&utm_content=456&utm_medium=789&utm_source=101112&utm_term=131415');
    expect(baseUrlParser.origin).to.eq('https://www.intempt.com');
    expect(baseUrlParser.pathname).to.eq('/test');
    expect(baseUrlParser.utmCampaign).to.eq('123');
    expect(baseUrlParser.utmContent).to.eq('456');
    expect(baseUrlParser.utmMedium).to.eq('789');
    expect(baseUrlParser.utmSource).to.eq('101112');
    expect(baseUrlParser.utmTerm).to.eq('131415');
    expect(baseUrlParser.urlHash).to.eq('#hash');
  })
})
