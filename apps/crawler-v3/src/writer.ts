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
  CacheLocation,
  ScrapedCourse
} from './types';
import { findBuildingLocation, logMissingLocations } from './locations';

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
      restrictions: new Map(),
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
      restrictions: [],
      gradeBases: [],
      locations: [],
      finalDates: [],
      finalTimes: []
    };
  }

  /**
   * Add period (time range) to cache and return its index
   * Converts minutes from midnight to HHMM format
   * Returns "ARRANGED" for -1, "TBA" for -2
   */
  private addPeriodToCache(startTime: number, endTime: number): number {
    // Handle ARRANGED times (indicated by -1)
    if (startTime === -1 || endTime === -1) {
      const arrangedIndex = this.caches.periods.indexOf('ARRANGED');
      if (arrangedIndex !== -1) {
        return arrangedIndex;
      }
      const index = this.caches.periods.length;
      this.caches.periods.push('ARRANGED');
      return index;
    }

    // Handle TBA/unknown times (indicated by -2)
    if (startTime === -2 || endTime === -2) {
      const tbaIndex = this.caches.periods.indexOf('TBA');
      if (tbaIndex !== -1) {
        return tbaIndex;
      }
      const index = this.caches.periods.length;
      this.caches.periods.push('TBA');
      return index;
    }

    // Convert minutes from midnight to HHMM format
    // e.g., 720 minutes (12:00 PM) -> 1200
    const minutesToHHMM = (minutes: number): string => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return (hours * 100 + mins).toString().padStart(4, '0');
    };

    const startStr = minutesToHHMM(startTime);
    const endStr = minutesToHHMM(endTime);
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
   * Looks up building coordinates from the locations map
   */
  private addLocationToCache(room: string): number {
    // Look up building coordinates
    const coords = findBuildingLocation(room);
    const location: CacheLocation = coords
      ? { lat: coords.lat, long: coords.long }
      : { lat: null, long: null };

    // Check if we already have this exact location cached
    const existingIndex = this.caches.locations.findIndex(
      loc => loc.lat === location.lat && loc.long === location.long
    );
    if (existingIndex !== -1) {
      return existingIndex;
    }

    // Add new location
    const index = this.caches.locations.length;
    this.caches.locations.push(location);
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

        // Add location (room text for physical, empty string for online)
        const locationRoom = meeting.isOnline ? '' : meeting.room;
        const locationIndex = this.addLocationToCache(locationRoom);

        // Create meeting tuple
        return [
          periodIndex,
          meeting.days,
          meeting.room,
          locationIndex,
          meeting.instructors,
          -1, // dateRangeIndex (not stored)
          -1, // finalDateIndex (not implemented)
          -1  // finalTimeIndex (not implemented)
        ];
      });

      // Get cache indices
      const attributeIndices = scrapedSection.attributes.map(attr =>
        this.addToCache('attributes', attr)
      );

      // Get schedule type index (e.g., "Lecture", "Laboratory", "Discussion")
      const scheduleTypeIndex = this.addToCache('scheduleTypes', scrapedSection.scheduleType);

      // Create section tuple matching expected format:
      // [crn, meetings, credits, scheduleTypeIndex, campusIndex, attributeIndices, gradeBasisIndex]
      const section: Section = [
        scrapedSection.crn,
        meetings,
        scraped.creditHours,  // credits at index 2
        scheduleTypeIndex,    // scheduleTypeIndex (for lab/lecture detection)
        0,                    // campusIndex (default)
        attributeIndices,
        -1                    // gradeBasisIndex (not implemented)
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

    // Log any buildings that need coordinates added
    logMissingLocations();
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
   * Import existing caches to restore writer state when resuming.
   * This ensures that new courses get indices consistent with existing courses.
   */
  public importCaches(existingCaches: Caches): void {
    // Import string-based caches
    const stringCacheNames: (keyof CacheBuilder)[] = [
      'dateRanges',
      'scheduleTypes',
      'campuses',
      'attributes',
      'restrictions',
      'gradeBases',
      'finalDates',
      'finalTimes'
    ];

    for (const cacheName of stringCacheNames) {
      const values = existingCaches[cacheName] as string[];
      if (values) {
        // Copy values to caches array
        (this.caches[cacheName] as string[]) = [...values];
        // Rebuild the cacheBuilder Map for lookups
        this.cacheBuilder[cacheName] = new Map();
        values.forEach((value, index) => {
          this.cacheBuilder[cacheName].set(value, index);
        });
      }
    }

    // Import periods (stored as strings)
    if (existingCaches.periods) {
      this.caches.periods = [...existingCaches.periods];
      // Note: periods use a different lookup mechanism (linear search in addPeriodToCache)
    }

    // Import locations (complex objects)
    if (existingCaches.locations) {
      this.caches.locations = [...existingCaches.locations];
      // Note: locations use findIndex for deduplication in addLocationToCache
    }
  }
}
