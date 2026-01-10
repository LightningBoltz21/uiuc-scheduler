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
import { Course, TermData, Caches } from './types';

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
      gradeBases: [],
      locations: [],
      finalDates: [],
      finalTimes: []
    };
    
    // Maps to track unique cache entries
    const cacheMaps = {
      periods: new Map<string, any>(),
      dateRanges: new Map<string, string>(),
      scheduleTypes: new Map<string, string>(),
      campuses: new Map<string, string>(),
      attributes: new Map<string, string>(),
      gradeBases: new Map<string, string>(),
      locations: new Map<string, any>(),
      finalDates: new Map<string, string>(),
      finalTimes: new Map<string, string>()
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
        
        // Merge courses
        Object.assign(allCourses, subjectFile.courses);
        
        // Merge caches if present
        if (subjectFile.caches) {
          // Merge each cache array, deduplicating by JSON.stringify for complex types
          for (const item of subjectFile.caches.periods) {
            const key = JSON.stringify(item);
            if (!cacheMaps.periods.has(key)) {
              cacheMaps.periods.set(key, item);
            }
          }
          for (const item of subjectFile.caches.scheduleTypes) {
            if (!cacheMaps.scheduleTypes.has(item)) {
              cacheMaps.scheduleTypes.set(item, item);
            }
          }
          for (const item of subjectFile.caches.dateRanges) {
            if (!cacheMaps.dateRanges.has(item)) {
              cacheMaps.dateRanges.set(item, item);
            }
          }
          for (const item of subjectFile.caches.campuses) {
            if (!cacheMaps.campuses.has(item)) {
              cacheMaps.campuses.set(item, item);
            }
          }
          for (const item of subjectFile.caches.attributes) {
            if (!cacheMaps.attributes.has(item)) {
              cacheMaps.attributes.set(item, item);
            }
          }
          for (const item of subjectFile.caches.gradeBases) {
            if (!cacheMaps.gradeBases.has(item)) {
              cacheMaps.gradeBases.set(item, item);
            }
          }
          for (const item of subjectFile.caches.locations) {
            const key = JSON.stringify(item);
            if (!cacheMaps.locations.has(key)) {
              cacheMaps.locations.set(key, item);
            }
          }
          for (const item of subjectFile.caches.finalDates) {
            if (!cacheMaps.finalDates.has(item)) {
              cacheMaps.finalDates.set(item, item);
            }
          }
          for (const item of subjectFile.caches.finalTimes) {
            if (!cacheMaps.finalTimes.has(item)) {
              cacheMaps.finalTimes.set(item, item);
            }
          }
        }
      } catch (error) {
        console.warn(`  ⚠️  Could not read ${file}, skipping`);
      }
    }
    
    // Convert maps back to arrays
    mergedCaches.periods = Array.from(cacheMaps.periods.values());
    mergedCaches.dateRanges = Array.from(cacheMaps.dateRanges.values());
    mergedCaches.scheduleTypes = Array.from(cacheMaps.scheduleTypes.values());
    mergedCaches.campuses = Array.from(cacheMaps.campuses.values());
    mergedCaches.attributes = Array.from(cacheMaps.attributes.values());
    mergedCaches.gradeBases = Array.from(cacheMaps.gradeBases.values());
    mergedCaches.locations = Array.from(cacheMaps.locations.values());
    mergedCaches.finalDates = Array.from(cacheMaps.finalDates.values());
    mergedCaches.finalTimes = Array.from(cacheMaps.finalTimes.values());
    
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
