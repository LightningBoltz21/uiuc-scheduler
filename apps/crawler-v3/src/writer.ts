import * as fs from 'fs';
import * as path from 'path';
import {
  TermData,
  IndexData,
  Course,
  Section,
  Meeting,
  Caches,
  CacheBuilder,
  ScrapedCourse,
  SectionRestrictions
} from './types';

/**
 * Builds caches and converts scraped courses to tuple format
 */
export class DataWriter {
  private cacheBuilder: CacheBuilder;
  private caches: Caches;

  constructor() {
    this.cacheBuilder = {
      periods: new Map(),
      dateRanges: new Map(),
      scheduleTypes: new Map(),
      campuses: new Map(),
      attributes: new Map(),
      gradeBases: new Map(),
      locations: new Map(),
      finalDates: new Map(),
      finalTimes: new Map()
    };

    this.caches = {
      periods: [],
      dateRanges: [],
      scheduleTypes: [],
      campuses: [],
      attributes: [],
      gradeBases: [],
      locations: [],
      finalDates: [],
      finalTimes: []
    };
  }

  /**
   * Add period (time range) to cache and return its index
   */
  private addPeriodToCache(startTime: number, endTime: number): number {
    // Check if this exact period already exists
    for (let i = 0; i < this.caches.periods.length; i++) {
      const [start, end] = this.caches.periods[i];
      if (start === startTime && end === endTime) {
        return i;
      }
    }

    // Add new period
    const index = this.caches.periods.length;
    this.caches.periods.push([startTime, endTime]);
    return index;
  }

  /**
   * Add item to cache and return its index
   */
  private addToCache<T extends keyof CacheBuilder>(
    cacheName: T,
    value: string
  ): number {
    const cache = this.cacheBuilder[cacheName];
    
    if (cache.has(value)) {
      return cache.get(value)!;
    }

    const index = cache.size;
    cache.set(value, index);
    (this.caches[cacheName] as string[]).push(value);
    return index;
  }

  /**
   * Convert scraped course to tuple format
   */
  public convertCourse(scraped: ScrapedCourse): Course {
    const sectionsMap: Record<string, Section> = {};

    for (const scrapedSection of scraped.sections) {
      // Convert meetings to tuple format
      const meetings: Meeting[] = scrapedSection.meetings.map(meeting => {
        // Add period using minute offsets
        const periodIndex = this.addPeriodToCache(meeting.startTime, meeting.endTime);

        // Add date range
        const dateRangeIndex = this.addToCache('dateRanges', meeting.dateRange);

        // Add location (null for now, can be enhanced with coordinates)
        const locationIndex = this.addToCache('locations', meeting.building || 'TBA');
        if (!this.caches.locations[locationIndex]) {
          this.caches.locations[locationIndex] = null;
        }

        // Create meeting tuple
        return [
          periodIndex,
          meeting.days,
          meeting.room,
          locationIndex,
          meeting.instructors,
          dateRangeIndex,
          -1, // finalDateIndex (not implemented)
          -1  // finalTimeIndex (not implemented)
        ];
      });

      // Get cache indices
      const scheduleTypeIndex = this.addToCache('scheduleTypes', scrapedSection.scheduleType);
      const campusIndex = this.addToCache('campuses', scrapedSection.campus);
      const gradeBaseIndex = this.addToCache('gradeBases', scrapedSection.gradeBase);
      
      const attributeIndices = scrapedSection.attributes.map(attr => 
        this.addToCache('attributes', attr)
      );

      // Create restriction data
      const restrictionData: SectionRestrictions = {
        restrictions: scrapedSection.restrictions.map(r => ({
          type: 'general',
          values: [r]
        })),
        status: 'success'
      };

      // Create section tuple
      const section: Section = [
        scrapedSection.crn,
        meetings,
        scraped.creditHours,
        scheduleTypeIndex,
        campusIndex,
        attributeIndices,
        gradeBaseIndex,
        scrapedSection.sectionTitle,
        restrictionData
      ];

      sectionsMap[scrapedSection.sectionId] = section;
    }

    // Create course tuple
    return [
      scraped.title,
      sectionsMap,
      [], // prerequisites (empty for MVP)
      scraped.description,
      []  // corequisites (empty for MVP)
    ];
  }

  /**
   * Generate TermData JSON
   */
  public generateTermData(courses: Record<string, Course>): TermData {
    return {
      courses,
      caches: this.caches,
      updatedAt: new Date().toISOString(),
      version: 3
    };
  }

  /**
   * Write TermData to JSON file
   */
  public writeTermData(termData: TermData, termCode: string, outputDir: string): void {
    const filename = `${termCode}.json`;
    const filepath = path.join(outputDir, filename);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write JSON file
    const json = JSON.stringify(termData, null, 2);
    fs.writeFileSync(filepath, json, 'utf-8');
    
    console.log(`✅ Written: ${filepath} (${(json.length / 1024).toFixed(2)} KB)`);
  }

  /**
   * Write index.json with list of available terms
   */
  public writeIndex(terms: Array<{ term: string; name: string }>, outputDir: string): void {
    const indexData: IndexData = { terms };
    const filepath = path.join(outputDir, 'index.json');

    const json = JSON.stringify(indexData, null, 2);
    fs.writeFileSync(filepath, json, 'utf-8');
    
    console.log(`✅ Written: ${filepath}`);
  }

  /**
   * Get current caches
   */
  public getCaches(): Caches {
    return this.caches;
  }
}

/**
 * Convert UIUC term format to numeric code
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
  return `${termName} ${year}`;
}
