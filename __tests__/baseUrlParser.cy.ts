import { BaseURLParser } from '../src/intemptJs/_baseUrlParser.ts';

describe('BaseURLParser', () => {
  describe('Basic URL Parsing', () => {
    it('should parse complete URL with all components', () => {
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
    });

    it('should parse URL without query parameters', () => {
      const url = 'https://www.intempt.com/test#hash';
      const parser = new BaseURLParser(url);
      
      expect(parser.query).to.eq('');
      expect(parser.urlHash).to.eq('#hash');
      expect(parser.pathname).to.eq('/test');
      expect(parser.origin).to.eq('https://www.intempt.com');
    });

    it('should parse URL without hash', () => {
      const url = 'https://www.intempt.com/test?param=value';
      const parser = new BaseURLParser(url);
      
      expect(parser.urlHash).to.eq('');
      expect(parser.query).to.eq('?param=value');
      expect(parser.pathname).to.eq('/test');
    });

    it('should parse URL without query or hash', () => {
      const url = 'https://www.intempt.com/test';
      const parser = new BaseURLParser(url);
      
      expect(parser.query).to.eq('');
      expect(parser.urlHash).to.eq('');
      expect(parser.pathname).to.eq('/test');
      expect(parser.origin).to.eq('https://www.intempt.com');
    });
  });

  describe('UTM Parameters', () => {
    it('should extract all UTM parameters correctly', () => {
      const url = 'https://www.intempt.com/test?utm_campaign=123&utm_content=456&utm_medium=789&utm_source=101112&utm_term=131415#hash';
      const parser = new BaseURLParser(url);
      
      expect(parser.utmCampaign).to.eq('123');
      expect(parser.utmContent).to.eq('456');
      expect(parser.utmMedium).to.eq('789');
      expect(parser.utmSource).to.eq('101112');
      expect(parser.utmTerm).to.eq('131415');
    });

    it('should handle missing UTM parameters', () => {
      const url = 'https://www.intempt.com/test?other=value';
      const parser = new BaseURLParser(url);
      
      expect(parser.utmCampaign).to.eq('');
      expect(parser.utmContent).to.eq('');
      expect(parser.utmMedium).to.eq('');
      expect(parser.utmSource).to.eq('');
      expect(parser.utmTerm).to.eq('');
    });

    it('should handle partial UTM parameters', () => {
      const url = 'https://www.intempt.com/test?utm_source=google&utm_medium=cpc';
      const parser = new BaseURLParser(url);
      
      expect(parser.utmSource).to.eq('google');
      expect(parser.utmMedium).to.eq('cpc');
      expect(parser.utmCampaign).to.eq(''); // Missing
      expect(parser.utmContent).to.eq(''); // Missing
      expect(parser.utmTerm).to.eq(''); // Missing
    });

    it('should handle UTM parameters with special characters', () => {
      const url = 'https://www.intempt.com/test?utm_campaign=Summer%20Sale&utm_content=50%25%20Off';
      const parser = new BaseURLParser(url);
      
      // URLSearchParams automatically decodes
      expect(parser.utmCampaign).to.eq('Summer Sale');
      expect(parser.utmContent).to.eq('50% Off');
    });

    it('should handle empty UTM parameter values', () => {
      const url = 'https://www.intempt.com/test?utm_source=&utm_medium=cpc';
      const parser = new BaseURLParser(url);
      
      expect(parser.utmSource).to.eq('');
      expect(parser.utmMedium).to.eq('cpc');
    });
  });

  describe('URL Components', () => {
    it('should extract origin correctly', () => {
      const url = 'https://www.intempt.com:8080/test';
      const parser = new BaseURLParser(url);
      
      expect(parser.origin).to.eq('https://www.intempt.com:8080');
    });

    it('should extract pathname correctly', () => {
      const url = 'https://www.intempt.com/path/to/page';
      const parser = new BaseURLParser(url);
      
      expect(parser.pathname).to.eq('/path/to/page');
    });

    it('should extract domain correctly', () => {
      const url = 'https://subdomain.intempt.com/test';
      const parser = new BaseURLParser(url);
      
      expect(parser.domain).to.eq('subdomain.intempt.com');
    });
  });

  describe('Edge Cases', () => {
    it('should use window.location when no URL provided', () => {
      // Test that BaseURLParser can be instantiated without URL
      // It will use window.location.href by default
      const parser = new BaseURLParser();
      
      // Verify it parsed something (using actual window.location)
      expect(parser.origin).to.not.be.empty;
      expect(parser.pathname).to.be.a('string');
      expect(parser.domain).to.not.be.empty;
    });

    it('should handle root path correctly', () => {
      const url = 'https://www.intempt.com/?utm_source=test';
      const parser = new BaseURLParser(url);
      
      expect(parser.pathname).to.eq('/');
      expect(parser.utmSource).to.eq('test');
    });

    it('should handle URLs with multiple query parameters', () => {
      const url = 'https://www.intempt.com/test?utm_source=google&other_param=value&utm_medium=cpc';
      const parser = new BaseURLParser(url);
      
      expect(parser.utmSource).to.eq('google');
      expect(parser.utmMedium).to.eq('cpc');
      expect(parser.query).to.include('utm_source=google');
      expect(parser.query).to.include('utm_medium=cpc');
      expect(parser.query).to.include('other_param=value');
    });
  });
});
