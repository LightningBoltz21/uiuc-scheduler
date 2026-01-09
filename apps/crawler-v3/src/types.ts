/**
 * Type definitions for UIUC Crawler v3
 * Compatible with GT Scheduler frontend format
 */

// ===== Core Data Structures =====

export interface TermData {
  courses: Record<string, Course>;
  caches: Caches;
  updatedAt: string;
  version: number;
}

export interface TermInfo {
  term: string;
  name: string;
}

export interface IndexData {
  terms: TermInfo[];
}

// ===== Course & Section (Tuple Format) =====

/**
 * Course tuple structure:
 * [fullName, sections, prerequisites, description, corequisites]
 */
export type Course = [
  string,                           // 0: Full course name
  Record<string, Section>,          // 1: Sections map (key: section ID like "A", "B", "AL1")
  Prerequisites,                    // 2: Prerequisites tree
  string | null,                    // 3: Course description
  Corequisites                      // 4: Corequisites
];

/**
 * Section tuple structure:
 * [crn, meetings, creditHours, scheduleTypeIndex, campusIndex, attributeIndices, gradeBaseIndex, sectionTitle, restrictionData]
 */
export type Section = [
  string,                           // 0: CRN (Course Reference Number)
  Meeting[],                        // 1: Array of meeting times
  number,                           // 2: Credit hours
  number,                           // 3: Index into caches.scheduleTypes
  number,                           // 4: Index into caches.campuses
  number[],                         // 5: Indices into caches.attributes
  number,                           // 6: Index into caches.gradeBases
  string,                           // 7: Section-specific title
  SectionRestrictions               // 8: Enrollment restrictions
];

/**
 * Meeting tuple structure:
 * [periodIndex, days, room, locationIndex, instructors, dateRangeIndex, finalDateIndex, finalTimeIndex]
 */
export type Meeting = [
  number,                           // 0: Index into caches.periods
  string,                           // 1: Days (e.g., "MWF", "TR")
  string,                           // 2: Room location
  number,                           // 3: Index into caches.locations
  string[],                         // 4: Instructor names (with (P) for primary)
  number,                           // 5: Index into caches.dateRanges
  number,                           // 6: Index into caches.finalDates (-1 if none)
  number                            // 7: Index into caches.finalTimes (-1 if none)
];

// ===== Prerequisites & Corequisites =====

export type Prerequisites = PrerequisiteTree | [];

export type PrerequisiteTree = 
  | ["and", ...PrerequisiteTree[]]
  | ["or", ...PrerequisiteTree[]]
  | PrerequisiteCourse;

export interface PrerequisiteCourse {
  id: string;
  grade?: string;
}

export type Corequisites = Corequisite[];

export interface Corequisite {
  id: string;
}

// ===== Section Restrictions =====

export interface SectionRestrictions {
  restrictions: Restriction[];
  status: "success" | "error";
}

export interface Restriction {
  type: string;
  values: string[];
}

// ===== Caches (Shared Data) =====

export interface Caches {
  periods: string[];              // ["8:00 am - 8:50 am", "TBA"]
  dateRanges: string[];           // ["Aug 21, 2025 - Dec 10, 2025"]
  scheduleTypes: string[];        // ["Lecture", "Lab", "Discussion"]
  campuses: string[];             // ["Urbana-Champaign"]
  attributes: string[];           // ["Online", "Honors"]
  gradeBases: string[];           // ["Letter Grade", "Pass/Fail"]
  locations: (Location | null)[]; // Building coordinates
  finalDates: string[];           // ["Dec 12, 2025"]
  finalTimes: string[];           // ["1:30 pm - 4:30 pm"]
}

export interface Location {
  lat: number;
  long: number;
}

// ===== Scraping Utilities =====

export interface ScrapedCourse {
  subject: string;                // e.g., "CS"
  number: string;                 // e.g., "100"
  title: string;                  // e.g., "Computer Science Orientation"
  description: string | null;
  creditHours: number;
  sections: ScrapedSection[];
}

export interface ScrapedSection {
  crn: string;
  sectionId: string;              // e.g., "A", "B", "AL1"
  sectionTitle: string;
  scheduleType: string;           // e.g., "Lecture", "Lab"
  campus: string;
  attributes: string[];
  gradeBase: string;
  meetings: ScrapedMeeting[];
  restrictions: string[];
}

export interface ScrapedMeeting {
  days: string;                   // e.g., "MWF", "TR"
  startTime: string;              // e.g., "8:00 AM"
  endTime: string;                // e.g., "8:50 AM"
  room: string;                   // e.g., "Siebel Center 1404"
  building: string;               // e.g., "Siebel Center"
  instructors: string[];          // e.g., ["John Smith (P)"]
  dateRange: string;              // e.g., "Aug 21, 2025 - Dec 10, 2025"
}

// ===== Cache Builder Utilities =====

export interface CacheBuilder {
  periods: Map<string, number>;
  dateRanges: Map<string, number>;
  scheduleTypes: Map<string, number>;
  campuses: Map<string, number>;
  attributes: Map<string, number>;
  gradeBases: Map<string, number>;
  locations: Map<string, number>;
  finalDates: Map<string, number>;
  finalTimes: Map<string, number>;
}
