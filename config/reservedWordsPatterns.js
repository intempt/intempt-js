/**
 * Generates regex patterns to detect if a reserved word is used as a variable name
 * @param {string} word - The reserved word to generate patterns for
 * @returns {RegExp[]} Array of regex patterns
 */
export function getReservedWordPatterns(word) {
  // Escape special regex characters
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Patterns that indicate the word is used as a variable name
  return [
    // var/let/const declarations
    new RegExp(`\\b(var|let|const)\\s+${escapedWord}\\s*[=,;]`, 'g'),
    // Function declarations
    new RegExp(`\\bfunction\\s+${escapedWord}\\s*\\(`, 'g'),
    // Variable assignments (but not == or ===)
    new RegExp(`\\b${escapedWord}\\s*=\\s*[^=]`, 'g'),
    // As function parameter
    new RegExp(`\\(\\s*${escapedWord}\\s*[,)]`, 'g'),
    // In destructuring
    new RegExp(`\\{[^}]*\\b${escapedWord}\\s*[,:}]`, 'g'),
    // In array destructuring
    new RegExp(`\\[\\s*${escapedWord}\\s*[,]\\]`, 'g'),
    // Constructor calls (new keyword) - with optional space
    new RegExp(`\\bnew\\s*${escapedWord}\\s*\\(`, 'g'),
  ];
}

/**
 * Checks if a match should be excluded (e.g., template literals, strings)
 * @param {string} word - The reserved word
 * @param {string} match - The matched string
 * @param {number} matchIndex - Index of the match in the bundle code
 * @param {string} bundleCode - The full bundle code
 * @returns {boolean} True if the match should be excluded
 */
export function shouldExcludeMatch(word, match, matchIndex, bundleCode) {
  const before = bundleCode.substring(Math.max(0, matchIndex - 50), matchIndex);
  const after = bundleCode.substring(matchIndex + match.length, matchIndex + match.length + 50);
  
  // Special case: Exclude $ if it's part of a template literal ${...}
  if (word === '$') {
    const beforeChar = bundleCode.charAt(matchIndex - 1);
    if (beforeChar === '{') {
      // This is ${...} template literal, skip it
      return true;
    }
  }
  
  // Skip if surrounded by quotes (simple heuristic)
  const singleQuoteBefore = before.lastIndexOf("'");
  const singleQuoteAfter = after.indexOf("'");
  const doubleQuoteBefore = before.lastIndexOf('"');
  const doubleQuoteAfter = after.indexOf('"');
  const backtickBefore = before.lastIndexOf('`');
  const backtickAfter = after.indexOf('`');
  
  const inString = 
    (singleQuoteBefore !== -1 && singleQuoteAfter !== -1 && 
     (before.substring(singleQuoteBefore).match(/'/g) || []).length % 2 === 1) ||
    (doubleQuoteBefore !== -1 && doubleQuoteAfter !== -1 && 
     (before.substring(doubleQuoteBefore).match(/"/g) || []).length % 2 === 1) ||
    (backtickBefore !== -1 && backtickAfter !== -1);
  
  return inString;
}
