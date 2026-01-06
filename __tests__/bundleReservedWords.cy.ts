import { reservedWords } from '../config/reservedWords.js';
import { getReservedWordPatterns, shouldExcludeMatch } from '../config/reservedWordsPatterns.js';

describe('Bundle Reserved Words Check', () => {
  before(() => {
    // Build the bundle before running tests
    cy.exec('npm run build', { failOnNonZeroExit: false, timeout: 60000 }).then((result) => {
      if (result.code !== 0) {
        const errorOutput = result.stderr || result.stdout || 'Unknown error';
        cy.log(`Build stdout: ${result.stdout || '(empty)'}`);
        cy.log(`Build stderr: ${result.stderr || '(empty)'}`);
        throw new Error(`Build failed with exit code ${result.code}:\n${errorOutput}`);
      }
    });
  });

  it('should not use reserved words as variable names in the minified bundle', () => {
    cy.readFile('dist/intempt.min.js', 'utf-8', { timeout: 10000 }).then((bundleCode) => {
      if (!bundleCode || bundleCode.length === 0) {
        throw new Error('Bundle file is empty. Build may have failed.');
      }
      const violations: Array<{ word: string; match: string }> = [];

      reservedWords.forEach((word: string) => {
        const patterns = getReservedWordPatterns(word);

        patterns.forEach((pattern) => {
          const matches = bundleCode.match(pattern);
          if (matches) {
            matches.forEach((match: string) => {
              const matchIndex = bundleCode.indexOf(match);
              if (matchIndex !== -1) {
                if (!shouldExcludeMatch(word, match, matchIndex, bundleCode)) {
                  violations.push({ word, match: match.trim() });
                }
              }
            });
          }
        });
      });

      if (violations.length > 0) {
        const uniqueViolations = Array.from(
          new Map(violations.map(v => [`${v.word}:${v.match}`, v])).values()
        );
        
        const errorMessage = `Found ${uniqueViolations.length} reserved word(s) used as variable names:\n${uniqueViolations.map(v => `  - "${v.word}" found as: ${v.match}`).join('\n')}`;
        
        expect(violations.length).to.equal(0, errorMessage);
      } else {
        expect(violations.length).to.equal(0);
      }
    });
  });
});
