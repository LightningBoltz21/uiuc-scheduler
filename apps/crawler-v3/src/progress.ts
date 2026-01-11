/**
 * ProgressManager - Write-through cache system for crash recovery and resume capability
 * 
 * Directory structure:
 * /data/
 *   /{termCode}/
 *     /subjects/
 *       CS.json
 *       MATH.json
 *       ...
 *     progress.json
 *   {termCode}.json  (only created at end)
 *   indextemp.json   (renamed to index.json when ALL terms complete)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Course, TermData, Caches, Section, Meeting } from './types';

// ===== Type Definitions =====

export interface SubjectFile {
  subject: string;
  scrapedAt: number;
  courseCount: number;
  courses: Record<string, Course>;
  caches: Caches;  // Cache data for this subject's courses
}

export interface PartialSubjectProgress {
  completed: number;
  total: number;
  lastCourse: string;
}

export interface ProgressStats {
  successfulCourses: number;
  failedCourses: number;
  rateLimitCount: number;
}

export interface ProgressFile {
  termCode: string;
  termName: string;
  year: string;
  term: string;
  startedAt: number;
  lastUpdated: number;
  totalSubjects: number;
  totalCourses: number;
  subjects: string[];  // Cached subject list to avoid re-scraping on resume
  subjectCourseLists: Record<string, Array<{ subject: string; number: string; }>>; // Cached course lists per subject
  completedSubjects: string[];
  partialSubjects: Record<string, PartialSubjectProgress>;
  failedSubjects: string[];
  stats: ProgressStats;
}

export interface ResumeInfo {
  hasProgress: boolean;
  completedSubjects: Set<string>;
  partialSubjects: Map<string, PartialSubjectProgress>;
  subjectCourses: Map<string, Record<string, Course>>;
  stats: ProgressStats;
  totalCoursesScraped: number;
}

// ===== ProgressManager Class =====

export class ProgressManager {
  private outputDir: string;
  private termCode: string;
  private termName: string;
  private year: string;
  private term: string;
  private termDir: string;
  private subjectsDir: string;
  private progressFilePath: string;
  private progress: ProgressFile;

  constructor(
    outputDir: string,
    termCode: string,
    termName: string,
    year: string,
    term: string
  ) {
    this.outputDir = outputDir;
    this.termCode = termCode;
    this.termName = termName;
    this.year = year;
    this.term = term;
    
    // Use term code as directory name (e.g., "202602" for Spring 2026)
    this.termDir = path.join(outputDir, termCode);
    this.subjectsDir = path.join(this.termDir, 'subjects');
    this.progressFilePath = path.join(this.termDir, 'progress.json');
    
    // Initialize or load progress
    this.progress = this.loadOrCreateProgress();
  }

  // ===== Directory Management =====

  /**
   * Ensure all required directories exist
   */
  ensureDirectories(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.termDir)) {
      fs.mkdirSync(this.termDir, { recursive: true });
    }
    if (!fs.existsSync(this.subjectsDir)) {
      fs.mkdirSync(this.subjectsDir, { recursive: true });
    }
  }

  // ===== Progress File Management =====

  /**
   * Load existing progress or create new progress file
   */
  private loadOrCreateProgress(): ProgressFile {
    this.ensureDirectories();
    
    if (fs.existsSync(this.progressFilePath)) {
      try {
        const content = fs.readFileSync(this.progressFilePath, 'utf-8');
        const loaded = JSON.parse(content) as ProgressFile;
        
        // Backward compatibility: add subjects array if missing
        if (!loaded.subjects) {
          loaded.subjects = [];
        }
        if (!loaded.subjectCourseLists) {
          loaded.subjectCourseLists = {};
        }
        
        console.log(`  ✓ Loaded existing progress: ${loaded.stats.successfulCourses} courses scraped`);
        return loaded;
      } catch (error) {
        console.warn(`  ⚠️  Could not parse progress.json, starting fresh`);
      }
    }
    
    // Create new progress file
    const newProgress: ProgressFile = {
      termCode: this.termCode,
      termName: this.termName,
      year: this.year,
      term: this.term,
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      totalSubjects: 0,
      totalCourses: 0,
      subjects: [],
      subjectCourseLists: {},
      completedSubjects: [],
      partialSubjects: {},
      failedSubjects: [],
      stats: {
        successfulCourses: 0,
        failedCourses: 0,
        rateLimitCount: 0
      }
    };
    
    return newProgress;
  }

  /**
   * Save progress file to disk
   */
  saveProgress(): void {
    this.progress.lastUpdated = Date.now();
    const json = JSON.stringify(this.progress, null, 2);
    fs.writeFileSync(this.progressFilePath, json, 'utf-8');
  }

  /**
   * Update totals after discovering subjects and courses
   */
  updateTotals(totalSubjects: number, totalCourses: number): void {
    this.progress.totalSubjects = totalSubjects;
    this.progress.totalCourses = totalCourses;
    this.saveProgress();
  }

  /**
   * Cache subject list to avoid re-scraping on resume
   */
  cacheSubjects(subjects: string[]): void {
    this.progress.subjects = subjects;
    this.saveProgress();
  }

  /**
   * Get cached subject list (returns null if not cached)
   */
  getCachedSubjects(): string[] | null {
    return this.progress.subjects && this.progress.subjects.length > 0 ? this.progress.subjects : null;
  }

  /**
   * Cache course lists for all subjects
   */
  cacheCourseLists(subjectCourseLists: Record<string, Array<{ subject: string; number: string; }>>): void {
    this.progress.subjectCourseLists = subjectCourseLists;
    this.saveProgress();
  }

  /**
   * Get cached course lists (returns null if not cached)
   */
  getCachedCourseLists(): Record<string, Array<{ subject: string; number: string; }>> | null {
    return this.progress.subjectCourseLists && Object.keys(this.progress.subjectCourseLists).length > 0 
      ? this.progress.subjectCourseLists 
      : null;
  }

  /**
   * Get current progress stats
   */
  getStats(): ProgressStats {
    return { ...this.progress.stats };
  }

  /**
   * Update stats
   */
  updateStats(stats: Partial<ProgressStats>): void {
    Object.assign(this.progress.stats, stats);
  }

  /**
   * Increment successful course count
   */
  incrementSuccess(): void {
    this.progress.stats.successfulCourses++;
  }

  /**
   * Increment failed course count
   */
  incrementFailure(): void {
    this.progress.stats.failedCourses++;
  }

  /**
   * Increment rate limit count
   */
  incrementRateLimit(): void {
    this.progress.stats.rateLimitCount++;
  }

  // ===== Subject File Management =====

  /**
   * Get path for subject JSON file
   */
  getSubjectFilePath(subject: string): string {
    return path.join(this.subjectsDir, `${subject}.json`);
  }

  /**
   * Load subject file if it exists
   */
  loadSubjectFile(subject: string): SubjectFile | null {
    const filePath = this.getSubjectFilePath(subject);
    
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as SubjectFile;
      } catch (error) {
        console.warn(`  ⚠️  Could not parse ${subject}.json, starting fresh for this subject`);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Save subject file to disk
   */
  saveSubjectFile(subject: string, courses: Record<string, Course>, caches: Caches): void {
    const filePath = this.getSubjectFilePath(subject);
    const subjectFile: SubjectFile = {
      subject,
      scrapedAt: Date.now(),
      courseCount: Object.keys(courses).length,
      courses,
      caches
    };
    
    const json = JSON.stringify(subjectFile, null, 2);
    fs.writeFileSync(filePath, json, 'utf-8');
  }

  /**
   * Get courses already scraped for a subject
   */
  getScrapedCourses(subject: string): Record<string, Course> {
    const subjectFile = this.loadSubjectFile(subject);
    return subjectFile?.courses ?? {};
  }

  /**
   * Get count of courses scraped for a subject
   */
  getScrapedCourseCount(subject: string): number {
    const subjectFile = this.loadSubjectFile(subject);
    return subjectFile?.courseCount ?? 0;
  }

  // ===== Subject Completion Tracking =====

  /**
   * Check if subject is fully completed
   */
  isSubjectCompleted(subject: string): boolean {
    return this.progress.completedSubjects.includes(subject);
  }

  /**
   * Check if subject has partial progress
   */
  getPartialProgress(subject: string): PartialSubjectProgress | null {
    return this.progress.partialSubjects[subject] ?? null;
  }

  /**
   * Mark subject as having partial progress
   */
  markSubjectPartial(subject: string, completed: number, total: number, lastCourse: string): void {
    this.progress.partialSubjects[subject] = { completed, total, lastCourse };
    this.saveProgress();
  }

  /**
   * Mark subject as fully completed
   */
  markSubjectCompleted(subject: string): void {
    // Remove from partial if present
    delete this.progress.partialSubjects[subject];
    
    // Add to completed if not already there
    if (!this.progress.completedSubjects.includes(subject)) {
      this.progress.completedSubjects.push(subject);
    }
    
    // Remove from failed if present
    const failedIndex = this.progress.failedSubjects.indexOf(subject);
    if (failedIndex > -1) {
      this.progress.failedSubjects.splice(failedIndex, 1);
    }
    
    this.saveProgress();
  }

  /**
   * Mark subject as failed
   */
  markSubjectFailed(subject: string): void {
    if (!this.progress.failedSubjects.includes(subject)) {
      this.progress.failedSubjects.push(subject);
    }
    this.saveProgress();
  }

  // ===== Resume Information =====

  /**
   * Get comprehensive resume information
   */
  getResumeInfo(): ResumeInfo {
    const completedSubjects = new Set(this.progress.completedSubjects);
    const partialSubjects = new Map<string, PartialSubjectProgress>();
    const subjectCourses = new Map<string, Record<string, Course>>();
    
    // Load partial subjects info
    for (const [subject, partial] of Object.entries(this.progress.partialSubjects)) {
      partialSubjects.set(subject, partial);
      
      // Also load the courses for this partial subject
      const courses = this.getScrapedCourses(subject);
      if (Object.keys(courses).length > 0) {
        subjectCourses.set(subject, courses);
      }
    }
    
    return {
      hasProgress: this.progress.stats.successfulCourses > 0 || completedSubjects.size > 0,
      completedSubjects,
      partialSubjects,
      subjectCourses,
      stats: { ...this.progress.stats },
      totalCoursesScraped: this.progress.stats.successfulCourses
    };
  }

  /**
   * Log resume status at startup
   */
  logResumeStatus(): void {
    const info = this.getResumeInfo();
    
    if (!info.hasProgress) {
      console.log(`  ✓ No existing progress found, starting fresh`);
      return;
    }
    
    const completedCount = info.completedSubjects.size;
    const totalSubjects = this.progress.totalSubjects || '?';
    const totalCourses = this.progress.totalCourses || '?';
    const percent = this.progress.totalCourses 
      ? ((info.stats.successfulCourses / this.progress.totalCourses) * 100).toFixed(1)
      : '?';
    
    console.log(`  ✓ Found progress.json: ${info.stats.successfulCourses}/${totalCourses} courses complete (${percent}%)`);
    console.log(`  ✓ Completed subjects: ${completedCount}/${totalSubjects}`);
    
    if (info.partialSubjects.size > 0) {
      for (const [subject, partial] of info.partialSubjects) {
        console.log(`  ✓ Partial: ${subject} (${partial.completed}/${partial.total} courses)`);
      }
      const firstPartial = [...info.partialSubjects.entries()][0];
      if (firstPartial) {
        console.log(`  → Resuming from ${firstPartial[0]} course #${firstPartial[1].completed + 1}`);
      }
    }
  }

  // ===== Final Merge =====

  /**
   * Merge all subject files into single courses map and merged caches
   */
  mergeAllSubjects(): { courses: Record<string, Course>; caches: Caches } {
    const allCourses: Record<string, Course> = {};
    const mergedCaches: Caches = {
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

    // Maps to track unique cache entries and their new indices
    const cacheMaps = {
      periods: new Map<string, number>(),
      dateRanges: new Map<string, number>(),
      scheduleTypes: new Map<string, number>(),
      campuses: new Map<string, number>(),
      attributes: new Map<string, number>(),
      restrictions: new Map<string, number>(),
      gradeBases: new Map<string, number>(),
      locations: new Map<string, number>(),
      finalDates: new Map<string, number>(),
      finalTimes: new Map<string, number>()
    };

    // Read all subject files from subjects directory
    if (!fs.existsSync(this.subjectsDir)) {
      return { courses: allCourses, caches: mergedCaches };
    }

    const files = fs.readdirSync(this.subjectsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(this.subjectsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const subjectFile = JSON.parse(content) as SubjectFile;

        // Build index remapping for this subject file
        const indexMaps = {
          periods: new Map<number, number>(),
          dateRanges: new Map<number, number>(),
          scheduleTypes: new Map<number, number>(),
          campuses: new Map<number, number>(),
          attributes: new Map<number, number>(),
          restrictions: new Map<number, number>(),
          gradeBases: new Map<number, number>(),
          locations: new Map<number, number>(),
          finalDates: new Map<number, number>(),
          finalTimes: new Map<number, number>()
        };

        // Merge caches and build index mappings
        if (subjectFile.caches) {
          // Periods (complex type, use JSON.stringify as key)
          subjectFile.caches.periods.forEach((item, oldIndex) => {
            const key = JSON.stringify(item);
            if (!cacheMaps.periods.has(key)) {
              const newIndex = mergedCaches.periods.length;
              cacheMaps.periods.set(key, newIndex);
              mergedCaches.periods.push(item);
              indexMaps.periods.set(oldIndex, newIndex);
            } else {
              indexMaps.periods.set(oldIndex, cacheMaps.periods.get(key)!);
            }
          });

          // Schedule types
          subjectFile.caches.scheduleTypes.forEach((item, oldIndex) => {
            if (!cacheMaps.scheduleTypes.has(item)) {
              const newIndex = mergedCaches.scheduleTypes.length;
              cacheMaps.scheduleTypes.set(item, newIndex);
              mergedCaches.scheduleTypes.push(item);
              indexMaps.scheduleTypes.set(oldIndex, newIndex);
            } else {
              indexMaps.scheduleTypes.set(oldIndex, cacheMaps.scheduleTypes.get(item)!);
            }
          });

          // Date ranges
          subjectFile.caches.dateRanges.forEach((item, oldIndex) => {
            if (!cacheMaps.dateRanges.has(item)) {
              const newIndex = mergedCaches.dateRanges.length;
              cacheMaps.dateRanges.set(item, newIndex);
              mergedCaches.dateRanges.push(item);
              indexMaps.dateRanges.set(oldIndex, newIndex);
            } else {
              indexMaps.dateRanges.set(oldIndex, cacheMaps.dateRanges.get(item)!);
            }
          });

          // Campuses
          subjectFile.caches.campuses.forEach((item, oldIndex) => {
            if (!cacheMaps.campuses.has(item)) {
              const newIndex = mergedCaches.campuses.length;
              cacheMaps.campuses.set(item, newIndex);
              mergedCaches.campuses.push(item);
              indexMaps.campuses.set(oldIndex, newIndex);
            } else {
              indexMaps.campuses.set(oldIndex, cacheMaps.campuses.get(item)!);
            }
          });

          // Attributes
          subjectFile.caches.attributes.forEach((item, oldIndex) => {
            if (!cacheMaps.attributes.has(item)) {
              const newIndex = mergedCaches.attributes.length;
              cacheMaps.attributes.set(item, newIndex);
              mergedCaches.attributes.push(item);
              indexMaps.attributes.set(oldIndex, newIndex);
            } else {
              indexMaps.attributes.set(oldIndex, cacheMaps.attributes.get(item)!);
            }
          });

          // Restrictions
          (subjectFile.caches.restrictions || []).forEach((item, oldIndex) => {
            if (!cacheMaps.restrictions.has(item)) {
              const newIndex = mergedCaches.restrictions.length;
              cacheMaps.restrictions.set(item, newIndex);
              mergedCaches.restrictions.push(item);
              indexMaps.restrictions.set(oldIndex, newIndex);
            } else {
              indexMaps.restrictions.set(oldIndex, cacheMaps.restrictions.get(item)!);
            }
          });

          // Grade bases
          subjectFile.caches.gradeBases.forEach((item, oldIndex) => {
            if (!cacheMaps.gradeBases.has(item)) {
              const newIndex = mergedCaches.gradeBases.length;
              cacheMaps.gradeBases.set(item, newIndex);
              mergedCaches.gradeBases.push(item);
              indexMaps.gradeBases.set(oldIndex, newIndex);
            } else {
              indexMaps.gradeBases.set(oldIndex, cacheMaps.gradeBases.get(item)!);
            }
          });

          // Locations (complex type, use JSON.stringify as key)
          subjectFile.caches.locations.forEach((item, oldIndex) => {
            const key = JSON.stringify(item);
            if (!cacheMaps.locations.has(key)) {
              const newIndex = mergedCaches.locations.length;
              cacheMaps.locations.set(key, newIndex);
              mergedCaches.locations.push(item);
              indexMaps.locations.set(oldIndex, newIndex);
            } else {
              indexMaps.locations.set(oldIndex, cacheMaps.locations.get(key)!);
            }
          });

          // Final dates
          subjectFile.caches.finalDates.forEach((item, oldIndex) => {
            if (!cacheMaps.finalDates.has(item)) {
              const newIndex = mergedCaches.finalDates.length;
              cacheMaps.finalDates.set(item, newIndex);
              mergedCaches.finalDates.push(item);
              indexMaps.finalDates.set(oldIndex, newIndex);
            } else {
              indexMaps.finalDates.set(oldIndex, cacheMaps.finalDates.get(item)!);
            }
          });

          // Final times
          subjectFile.caches.finalTimes.forEach((item, oldIndex) => {
            if (!cacheMaps.finalTimes.has(item)) {
              const newIndex = mergedCaches.finalTimes.length;
              cacheMaps.finalTimes.set(item, newIndex);
              mergedCaches.finalTimes.push(item);
              indexMaps.finalTimes.set(oldIndex, newIndex);
            } else {
              indexMaps.finalTimes.set(oldIndex, cacheMaps.finalTimes.get(item)!);
            }
          });
        }

        // Remap indices in course data
        for (const [courseId, course] of Object.entries(subjectFile.courses)) {
          // Course is a tuple: [title, sections, prereqs, description, coreqs]
          const [title, sections, prereqs, description, coreqs] = course;

          // Remap indices in each section
          const remappedSections: Record<string, Section> = {};
          for (const [sectionId, section] of Object.entries(sections)) {
            // Section is: [crn, meetings, credits, scheduleTypeIndex, campusIndex, attributeIndices, gradeBasisIndex]
            const [crn, meetings, credits, scheduleTypeIndex, campusIndex, attributeIndices, gradeBasisIndex] = section;

            // Remap meetings
            const remappedMeetings: Meeting[] = meetings.map(meeting => {
              // Meeting is: [periodIndex, days, room, locationIndex, instructors, dateRangeIndex, finalDateIndex, finalTimeIndex]
              const [periodIndex, days, room, locationIndex, instructors, dateRangeIndex, finalDateIndex, finalTimeIndex] = meeting;

              return [
                indexMaps.periods.get(periodIndex) ?? periodIndex,
                days,
                room,
                indexMaps.locations.get(locationIndex) ?? locationIndex,
                instructors,
                dateRangeIndex >= 0 ? (indexMaps.dateRanges.get(dateRangeIndex) ?? dateRangeIndex) : dateRangeIndex,
                finalDateIndex >= 0 ? (indexMaps.finalDates.get(finalDateIndex) ?? finalDateIndex) : finalDateIndex,
                finalTimeIndex >= 0 ? (indexMaps.finalTimes.get(finalTimeIndex) ?? finalTimeIndex) : finalTimeIndex
              ];
            });

            // Remap attribute indices
            const remappedAttributeIndices = attributeIndices.map(idx =>
              indexMaps.attributes.get(idx) ?? idx
            );

            // Create remapped section
            remappedSections[sectionId] = [
              crn,
              remappedMeetings,
              credits,
              indexMaps.scheduleTypes.get(scheduleTypeIndex) ?? scheduleTypeIndex,
              indexMaps.campuses.get(campusIndex) ?? campusIndex,
              remappedAttributeIndices,
              gradeBasisIndex >= 0 ? (indexMaps.gradeBases.get(gradeBasisIndex) ?? gradeBasisIndex) : gradeBasisIndex
            ];
          }

          // Add remapped course to allCourses
          allCourses[courseId] = [title, remappedSections, prereqs, description, coreqs];
        }
      } catch (error) {
        console.warn(`  ⚠️  Could not read ${file}, skipping`);
      }
    }

    return { courses: allCourses, caches: mergedCaches };
  }

  /**
   * Clean up temporary files after successful merge
   */
  cleanup(): void {
    try {
      // Delete subjects directory recursively
      if (fs.existsSync(this.subjectsDir)) {
        fs.rmSync(this.subjectsDir, { recursive: true, force: true });
      }
      
      // Delete progress file
      if (fs.existsSync(this.progressFilePath)) {
        fs.unlinkSync(this.progressFilePath);
      }
      
      // Delete term directory if empty
      if (fs.existsSync(this.termDir)) {
        const remaining = fs.readdirSync(this.termDir);
        if (remaining.length === 0) {
          fs.rmdirSync(this.termDir);
        }
      }
      
      console.log(`  ✓ Cleaned up temporary files`);
    } catch (error) {
      console.warn(`  ⚠️  Could not fully clean up temporary files:`, error);
    }
  }

  /**
   * Get overall progress percentage
   */
  getOverallProgressPercent(): number {
    if (this.progress.totalCourses === 0) return 0;
    return (this.progress.stats.successfulCourses / this.progress.totalCourses) * 100;
  }

  /**
   * Get completed subject count
   */
  getCompletedSubjectCount(): number {
    return this.progress.completedSubjects.length;
  }

  /**
   * Get total subject count
   */
  getTotalSubjectCount(): number {
    return this.progress.totalSubjects;
  }

  /**
   * Get total courses scraped so far
   */
  getTotalCoursesScraped(): number {
    return this.progress.stats.successfulCourses;
  }

  /**
   * Get total courses expected
   */
  getTotalCoursesExpected(): number {
    return this.progress.totalCourses;
  }
}

// ===== Index File Management =====

/**
 * Write temporary index file (indextemp.json)
 */
export function writeIndexTemp(
  terms: Array<{ term: string; name: string }>,
  outputDir: string
): void {
  const indexData = { terms };
  const tempPath = path.join(outputDir, 'indextemp.json');
  const json = JSON.stringify(indexData, null, 2);
  fs.writeFileSync(tempPath, json, 'utf-8');
}

/**
 * Promote indextemp.json to index.json (atomic rename)
 */
export function promoteIndexTemp(outputDir: string): boolean {
  const tempPath = path.join(outputDir, 'indextemp.json');
  const finalPath = path.join(outputDir, 'index.json');
  
  if (!fs.existsSync(tempPath)) {
    console.warn(`  ⚠️  indextemp.json not found, cannot promote`);
    return false;
  }
  
  try {
    // Use rename for atomic operation
    fs.renameSync(tempPath, finalPath);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to promote index.json:`, error);
    return false;
  }
}

/**
 * Check if indextemp.json exists
 */
export function hasIndexTemp(outputDir: string): boolean {
  return fs.existsSync(path.join(outputDir, 'indextemp.json'));
}

/**
 * Delete indextemp.json (on failure/abort)
 */
export function deleteIndexTemp(outputDir: string): void {
  const tempPath = path.join(outputDir, 'indextemp.json');
  if (fs.existsSync(tempPath)) {
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      // Ignore errors
    }
  }
}
