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
   * Stores the room text string for physical locations, or empty string for online
   */
  private addLocationToCache(room: string): number {
    // Find existing location with same room text
    const existingIndex = this.caches.locations.findIndex(loc => loc === room);
    if (existingIndex !== -1) {
      return existingIndex;
    }
    
    // Add new location
    const index = this.caches.locations.length;
    this.caches.locations.push(room);
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
      const scheduleTypeIndex = this.addToCache('scheduleTypes', scrapedSection.scheduleType);
      
      // Campus and grade base: not stored in cache, use -1
      const campusIndex = -1;
      const gradeBaseIndex = -1;
      
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
   * Rebuild caches from tuple-format courses (for merged data)
   * This extracts unique values from courses already in tuple format
   */
  public rebuildCachesFromTuples(courses: Record<string, Course>): void {
    // Reset caches
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

    // Process each course to rebuild caches
    for (const [_, course] of Object.entries(courses)) {
      const sections = course[1]; // sections object
      
      for (const [_, section] of Object.entries(sections)) {
        // Section is [crn, meetings, creditHours, scheduleTypeIndex, campusIndex, attributeIndices, gradeBaseIndex]
        const scheduleTypeIndex = section[3]; // scheduleType index
        const meetings = section[1]; // meetings array
        
        // Build scheduleTypes from section data
        // We only have indices, so create entries for each unique index seen
        if (typeof scheduleTypeIndex === 'number' && scheduleTypeIndex >= 0) {
          // Use index as key to track unique schedule types
          const indexKey = `${scheduleTypeIndex}`;
          if (!this.cacheBuilder.scheduleTypes.has(indexKey)) {
            this.cacheBuilder.scheduleTypes.set(indexKey, scheduleTypeIndex);
          }
        }
        
        for (const meeting of meetings) {
          // meeting is [periodIndex, days, room, locationIndex, instructors, dateRangeIndex, finalDateIndex, finalTimeIndex]
          const [periodIndex, days, room] = meeting;
          
          // Period: extract from days + time string (combined format like "F      TR")
          if (typeof days === 'string' && days.trim()) {
            if (!this.cacheBuilder.periods.has(days)) {
              this.cacheBuilder.periods.set(days, this.cacheBuilder.periods.size);
            }
          }
          
          // Location: room is stored as string
          if (typeof room === 'string' && room.trim()) {
            if (!this.cacheBuilder.locations.has(room)) {
              this.cacheBuilder.locations.set(room, this.cacheBuilder.locations.size);
            }
          }
        }
        
        // Handle section-level caches
        const attributes = section[5]; // attributes array
        if (Array.isArray(attributes)) {
          for (const attr of attributes) {
            if (typeof attr === 'string') {
              if (!this.cacheBuilder.attributes.has(attr)) {
                this.cacheBuilder.attributes.set(attr, this.cacheBuilder.attributes.size);
              }
            }
          }
        }
        
        const gradeBase = section[6]; // grade base
        if (typeof gradeBase === 'string') {
          if (!this.cacheBuilder.gradeBases.has(gradeBase)) {
            this.cacheBuilder.gradeBases.set(gradeBase, this.cacheBuilder.gradeBases.size);
          }
        }
      }
    }
    
    // Convert Maps to arrays
    this.caches = {
      periods: Array.from(this.cacheBuilder.periods.keys()),
      dateRanges: Array.from(this.cacheBuilder.dateRanges.keys()),
      scheduleTypes: Array.from(this.cacheBuilder.scheduleTypes.keys()),
      campuses: Array.from(this.cacheBuilder.campuses.keys()),
      attributes: Array.from(this.cacheBuilder.attributes.keys()),
      gradeBases: Array.from(this.cacheBuilder.gradeBases.keys()),
      locations: Array.from(this.cacheBuilder.locations.keys()),
      finalDates: Array.from(this.cacheBuilder.finalDates.keys()),
      finalTimes: Array.from(this.cacheBuilder.finalTimes.keys())
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
}
