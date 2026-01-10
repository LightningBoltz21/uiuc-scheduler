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
  ScrapedCourse
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
    // Format as string "0900 - 0950" with 4-digit padding
    const startStr = startTime.toString().padStart(4, '0');
    const endStr = endTime.toString().padStart(4, '0');
    const periodString = `${startStr} - ${endStr}`;
    
    // Check if this exact period already exists
    for (let i = 0; i < this.caches.periods.length; i++) {
      if (this.caches.periods[i] === periodString) {
        return i;
      }
    }

    // Add new period
    const index = this.caches.periods.length;
    this.caches.periods.push(periodString);
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
   * Add location to cache and return its index
   * For online classes, stores null instead of coordinates
   */
  private addLocationToCache(isOnline: boolean): number {
    if (isOnline) {
      // Check if null already exists in cache
      const existingIndex = this.caches.locations.findIndex(loc => loc === null);
      if (existingIndex !== -1) {
        return existingIndex;
      }
      
      // Add null for online classes
      const index = this.caches.locations.length;
      this.caches.locations.push(null);
      return index;
    }
    
    // For physical locations, we don't have coordinates from UIUC data yet
    // Store null for now (could be enhanced with a building->coordinates mapping)
    const existingIndex = this.caches.locations.findIndex(loc => loc === null);
    if (existingIndex !== -1) {
      return existingIndex;
    }
    
    const index = this.caches.locations.length;
    this.caches.locations.push(null);
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

        // Add location (null for online classes, null for physical locations without coordinates)
        const locationIndex = this.addLocationToCache(meeting.isOnline);

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
      
      // Grade base: use index if valid, -1 otherwise
      const gradeBaseIndex = scrapedSection.gradeBase 
        ? this.addToCache('gradeBases', scrapedSection.gradeBase)
        : -1;
      
      const attributeIndices = scrapedSection.attributes.map(attr => 
        this.addToCache('attributes', attr)
      );

      // Create section tuple (7 elements)
      const section: Section = [
        scrapedSection.crn,
        meetings,
        scraped.creditHours,
        scheduleTypeIndex,
        campusIndex,
        attributeIndices,
        gradeBaseIndex
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
