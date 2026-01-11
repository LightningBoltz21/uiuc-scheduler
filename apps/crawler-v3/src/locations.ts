/**
 * UIUC Building Locations with Coordinates
 *
 * This file maps building names to their lat/long coordinates.
 * Data sourced from UIUC campus coordinates CSV.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Location {
  lat: number;
  long: number;
}

/**
 * Map of UIUC building names to coordinates
 * Populated from coordinates.csv at runtime
 */
export const buildingCoordinates = new Map<string, Location>();

// Load coordinates from CSV file
function loadCoordinatesFromCSV(): void {
  // CSV is in the data folder
  const csvPath = path.join(process.cwd(), 'data', 'coordinates.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('⚠️  data/coordinates.csv not found, location matching will be disabled');
    return;
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV: "Place ID","Title","Latitude","Longitude"
    // Handle quoted fields properly
    const match = line.match(/"([^"]*)","([^"]*)","([^"]*)","([^"]*)"/);
    if (match) {
      const title = match[2].trim();
      const lat = parseFloat(match[3]);
      const long = parseFloat(match[4]);

      if (title && !isNaN(lat) && !isNaN(long) && lat !== 0 && long !== 0) {
        buildingCoordinates.set(title, { lat, long });
      }
    }
  }

  console.log(`📍 Loaded ${buildingCoordinates.size} building coordinates`);
}

// Load coordinates on module initialization
loadCoordinatesFromCSV();

/**
 * Manual mapping for common building name variations
 * Maps scraped names -> CSV names
 */
const BUILDING_NAME_ALIASES = new Map<string, string>([
  // Common variations
  ['Agricultural Engr Sciences Bld', 'Agricultural Engineering Sciences Building'],
  ['Literatures, Cultures, & Ling', 'Languages, Cultures, and Linguistics Building (LCLB)'],
  ['Literatures Cultures & Ling', 'Languages, Cultures, and Linguistics Building (LCLB)'],

  // Add more aliases as needed based on crawler output
]);

/**
 * Common abbreviations used in UIUC building names
 * Used to normalize building names before matching
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bEngr\b/gi, 'Engineering'],
  [/\bBld\b/gi, 'Building'],
  [/\bBldg\b/gi, 'Building'],
  [/\bSci\b/gi, 'Science'],
  [/\bSci\.\b/gi, 'Science'],
  [/\bLab\b/gi, 'Laboratory'],
  [/\bLib\b/gi, 'Library'],
  [/\bCtr\b/gi, 'Center'],
  [/\bRm\b/gi, 'Room'],
  [/\bUniv\b/gi, 'University'],
  [/\bAgr\b/gi, 'Agricultural'],
  [/\bAgric\b/gi, 'Agricultural'],
  [/\bMech\b/gi, 'Mechanical'],
  [/\bElec\b/gi, 'Electrical'],
  [/\bChem\b/gi, 'Chemistry'],
  [/\bPhys\b/gi, 'Physics'],
  [/\bPsych\b/gi, 'Psychology'],
  [/\bComm\b/gi, 'Communication'],
  [/\bEd\b/gi, 'Education'],
  [/\bAdmin\b/gi, 'Administration'],
  [/\bAud\b/gi, 'Auditorium'],
  [/\bRes\b/gi, 'Residence'],
  [/\bInstr\b/gi, 'Instructional'],
  [/\bHall\b/gi, 'Hall'],
];

/**
 * Locations to ignore (won't warn about missing coordinates)
 */
const IGNORED_LOCATIONS = [
  'TBA',
  'ONLINE',
  'ARRANGED',
  'n.a.',
  'n.a',
  '',
];

// Track missing locations for logging
const missingLocations = new Set<string>();

/**
 * Normalize a building name by:
 * 1. Removing room numbers (e.g., "208 Building Name" -> "Building Name")
 * 2. Expanding abbreviations
 * 3. Removing extra whitespace
 * 4. Converting to lowercase for comparison
 */
function normalizeBuildingName(name: string): string {
  let normalized = name.trim();

  // Remove leading room numbers (e.g., "208 Building" -> "Building")
  normalized = normalized.replace(/^\d+\s+/, '');

  // Remove trailing room numbers (e.g., "Building 208" -> "Building")
  normalized = normalized.replace(/\s+\d+$/, '');

  // Expand abbreviations
  for (const [pattern, replacement] of ABBREVIATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized.toLowerCase();
}

/**
 * Extract building name from a full room string
 * e.g., "208 Agricultural Engr Sciences Bld" -> "Agricultural Engr Sciences Bld"
 * e.g., "106B1 Engineering Hall" -> "Engineering Hall"
 */
function extractBuildingName(roomString: string): string {
  // Remove leading room number (including letters like "106B1", "M5", etc.)
  let cleaned = roomString.replace(/^[\dA-Z]+\s+/, '').trim();

  // Also try removing room numbers in format like "Room 123" or "Rm 123"
  cleaned = cleaned.replace(/^(Room|Rm)\s+[\dA-Z]+\s+/i, '').trim();

  return cleaned;
}

/**
 * Calculate similarity between two strings (simple word overlap)
 * Returns a score from 0 to 1
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }

  // Return Jaccard-like similarity
  return matches / Math.max(words1.size, words2.size);
}

/**
 * Find the best matching building coordinates for a given room string
 *
 * Matching strategy:
 * 1. Try exact match on building name (without room number)
 * 2. Try normalized match (expand abbreviations)
 * 3. Try substring match (building key contained in room string)
 * 4. Try fuzzy match (word overlap similarity)
 * 5. Return null if no match found
 */
export function findBuildingLocation(roomString: string): Location | null {
  // Skip ignored locations
  if (IGNORED_LOCATIONS.includes(roomString.toUpperCase()) ||
      IGNORED_LOCATIONS.includes(roomString)) {
    return null;
  }

  const buildingName = extractBuildingName(roomString);
  const normalizedInput = normalizeBuildingName(roomString);

  // 0. Try alias mapping first
  if (BUILDING_NAME_ALIASES.has(buildingName)) {
    const aliasedName = BUILDING_NAME_ALIASES.get(buildingName)!;
    if (buildingCoordinates.has(aliasedName)) {
      return buildingCoordinates.get(aliasedName)!;
    }
  }

  // 1. Try exact match on building name (without room number)
  if (buildingCoordinates.has(buildingName)) {
    return buildingCoordinates.get(buildingName)!;
  }

  // 2. Try normalized exact match
  for (const [key, location] of buildingCoordinates) {
    if (normalizeBuildingName(key) === normalizedInput) {
      return location;
    }
  }

  // 3. Try substring match (key contained in normalized input, or vice versa)
  for (const [key, location] of buildingCoordinates) {
    const normalizedKey = normalizeBuildingName(key);
    if (normalizedInput.includes(normalizedKey) || normalizedKey.includes(normalizedInput)) {
      return location;
    }
  }

  // 4. Try fuzzy match with similarity threshold
  let bestMatch: { key: string; location: Location; score: number } | null = null;
  for (const [key, location] of buildingCoordinates) {
    const normalizedKey = normalizeBuildingName(key);
    const score = calculateSimilarity(normalizedInput, normalizedKey);

    // Require at least 60% word overlap
    if (score >= 0.6 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { key, location, score };
    }
  }

  if (bestMatch) {
    return bestMatch.location;
  }

  // 5. No match found - track for logging
  if (buildingName && !missingLocations.has(buildingName)) {
    missingLocations.add(buildingName);
  }

  return null;
}

/**
 * Get all missing locations encountered during processing
 * Useful for identifying buildings that need coordinates added
 */
export function getMissingLocations(): string[] {
  return Array.from(missingLocations).sort();
}

/**
 * Clear the missing locations tracker
 */
export function clearMissingLocations(): void {
  missingLocations.clear();
}

/**
 * Log missing locations summary
 */
export function logMissingLocations(): void {
  const missing = getMissingLocations();
  if (missing.length > 0) {
    console.log(`\n⚠️  Missing coordinates for ${missing.length} buildings:`);
    missing.slice(0, 20).forEach(loc => console.log(`   - "${loc}"`));
    if (missing.length > 20) {
      console.log(`   ... and ${missing.length - 20} more`);
    }
    console.log('\nTo add coordinates, edit apps/crawler-v3/src/coordinates.csv');
  }
}
