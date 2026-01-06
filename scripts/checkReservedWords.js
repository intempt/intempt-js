import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { reservedWords } from '../config/reservedWords.js';
import { getReservedWordPatterns, shouldExcludeMatch } from '../config/reservedWordsPatterns.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function checkReservedWords() {
  const bundlePath = join(__dirname, '..', 'dist', 'intempt.min.js');
  
  try {
    const bundleCode = readFileSync(bundlePath, 'utf-8');
    
    if (!bundleCode || bundleCode.length === 0) {
      console.error('❌ Bundle file is empty. Build may have failed.');
      process.exit(1);
    }
    
    const violations = [];
    
    reservedWords.forEach((word) => {
      const patterns = getReservedWordPatterns(word);
      
      patterns.forEach((pattern) => {
        const matches = bundleCode.match(pattern);
        if (matches) {
          matches.forEach((match) => {
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
      
      console.error(`❌ Found ${uniqueViolations.length} reserved word(s) used as variable names:`);
      uniqueViolations.forEach(v => {
        console.error(`   - "${v.word}" found as: ${v.match}`);
      });
      process.exit(1);
    } else {
      console.log('✅ No reserved words found as variable names in the bundle.');
      process.exit(0);
    }
  } catch (error) {
    console.error(`❌ Error checking bundle: ${error.message}`);
    process.exit(1);
  }
}

checkReservedWords();
