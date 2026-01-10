/**
 * Utility functions for UIUC Crawler v3
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const UIUC_BASE_URL = 'https://courses.illinois.edu';

/**
 * Get integer config from environment variable
 */
export function getIntConfig(key: string): number | null {
  const value = process.env[key];
  if (value == null) return null;
  try {
    return parseInt(value, 10);
  } catch (err) {
    console.error(`Invalid integer config value provided for ${key}: ${value}`);
    return null;
  }
}

/**
 * Scrape all available years from UIUC
 */
async function scrapeAvailableYears(): Promise<string[]> {
  try {
    const response = await axios.get(`${UIUC_BASE_URL}/schedule`, {
      headers: {
        'User-Agent': 'uiuc-scheduler/crawler-v3 (educational project)'
      }
    });
    const html = response.data;
    const $ = cheerio.load(html);

    const years: string[] = [];
    $('table tbody tr td a').each((i, element) => {
      const href = $(element).attr('href');
      if (href) {
        const match = href.match(/\/schedule\/(\d{4})$/);
        if (match && match[1]) {
          years.push(match[1]);
        }
      }
    });

    return years.sort().reverse(); // Most recent first
  } catch (error) {
    console.error('Error fetching available years:', error);
    return [];
  }
}

/**
 * Scrape all available terms for a given year
 */
async function scrapeAvailableTermsForYear(year: string): Promise<Array<{ year: string; term: string }>> {
  try {
    const response = await axios.get(`${UIUC_BASE_URL}/schedule/${year}`, {
      headers: {
        'User-Agent': 'uiuc-scheduler/crawler-v3 (educational project)'
      }
    });
    const html = response.data;
    const $ = cheerio.load(html);

    const terms: Array<{ year: string; term: string }> = [];
    $('table tbody tr td a').each((i, element) => {
      const href = $(element).attr('href');
      if (href) {
        const match = href.match(/\/schedule\/\d{4}\/(\w+)$/);
        if (match && match[1]) {
          terms.push({ year, term: match[1] });
        }
      }
    });

    return terms;
  } catch (error) {
    console.error(`Error fetching terms for ${year}:`, error);
    return [];
  }
}

/**
 * Auto-discover the N most recent terms available on UIUC
 */
export async function discoverLatestTerms(numTerms: number): Promise<Array<{ year: string; term: string }>> {
  console.log(`🔍 Auto-discovering ${numTerms} most recent terms from UIUC...\n`);

  const years = await scrapeAvailableYears();
  if (years.length === 0) {
    console.error('❌ Could not discover any years');
    return [];
  }

  console.log(`  Found years: ${years.join(', ')}`);

  const allTerms: Array<{ year: string; term: string; order: number }> = [];

  // Term order for sorting (most recent first)
  const termOrder: Record<string, number> = {
    'fall': 3,
    'summer': 2,
    'spring': 1,
    'winter': 0
  };

  // Check the most recent 2-3 years to find available terms
  for (const year of years.slice(0, 3)) {
    const terms = await scrapeAvailableTermsForYear(year);
    
    for (const term of terms) {
      const order = parseInt(year) * 100 + (termOrder[term.term] ?? 0);
      allTerms.push({ ...term, order });
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Sort by order (most recent first) and take top N
  allTerms.sort((a, b) => b.order - a.order);
  const selectedTerms = allTerms.slice(0, numTerms).map(({ year, term }) => ({ year, term }));

  console.log(`\n  ✓ Selected ${selectedTerms.length} most recent terms:`);
  selectedTerms.forEach(({ year, term }) => {
    console.log(`    - ${getTermName(year, term)}`);
  });
  console.log();

  return selectedTerms;
}

/**
 * Generate list of terms to scrape based on NUM_TERMS
 * UIUC term order: Spring, Summer, Fall, Winter (within each year)
 */
export function generateTermsToScrape(numTerms: number): Array<{ year: string; term: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Determine current term based on month
  let currentTerm: string;
  if (currentMonth <= 1) {
    currentTerm = 'winter'; // Jan = Winter (previous year's winter)
  } else if (currentMonth <= 5) {
    currentTerm = 'spring'; // Feb-May = Spring
  } else if (currentMonth <= 8) {
    currentTerm = 'summer'; // Jun-Aug = Summer
  } else if (currentMonth <= 12) {
    currentTerm = 'fall'; // Sep-Dec = Fall
  } else {
    currentTerm = 'spring';
  }

  // UIUC academic year order (repeating cycle)
  const termOrder = ['spring', 'summer', 'fall', 'winter'];
  
  const terms: Array<{ year: string; term: string }> = [];
  
  // Find starting position in the cycle
  let currentTermIndex = termOrder.indexOf(currentTerm);
  let year = currentYear;
  
  // Winter term belongs to the next year in UIUC's system
  if (currentTerm === 'winter') {
    year = currentYear; // Winter 2025-2026 is accessed as 2026/winter
  }

  // Generate terms going backwards from current
  for (let i = 0; i < numTerms; i++) {
    const term = termOrder[currentTermIndex];
    
    // Adjust year for winter term (it spans two years but uses the latter)
    const termYear = term === 'winter' ? year : year;
    
    terms.push({ year: termYear.toString(), term });
    
    // Move backwards in the cycle
    currentTermIndex--;
    if (currentTermIndex < 0) {
      currentTermIndex = termOrder.length - 1;
      year--;
    } else if (term === 'spring') {
      // After spring, we go back to previous year's winter
      year--;
    }
  }

  return terms;
}

/**
 * Get term code from year and term name
 * @param year - e.g., "2025"
 * @param term - e.g., "fall", "spring"
 * @returns Numeric term code like "202508" (Fall 2025)
 */
export function getTermCode(year: string, term: string): string {
  const termCodes: Record<string, string> = {
    spring: '02',
    summer: '05',
    fall: '08',
    winter: '12'
  };
  
  const code = termCodes[term.toLowerCase()];
  if (!code) {
    throw new Error(`Invalid term: ${term}`);
  }
  
  return `${year}${code}`;
}

/**
 * Get human-readable term name
 */
export function getTermName(year: string, term: string): string {
  const termName = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
  
  // Winter term spans two years
  if (term.toLowerCase() === 'winter') {
    const prevYear = parseInt(year) - 1;
    return `Winter ${prevYear}-${year}`;
  }
  
  return `${termName} ${year}`;
}
