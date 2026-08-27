import { Course, Oscar, Section } from './beans';
import { CLOSE, OPEN, PALETTE } from '../constants';
import { Meeting, Period } from '../types';
import { hasConflictBetween } from '../utils/misc';

// Builds the schedule that a first-time visitor is greeted with,
// so that the app opens on a filled-in calendar instead of an empty grid.
//
// Everything in this file is pure and deterministic:
// given the same term data it always produces the same courses and CRNs,
// which keeps the seed reproducible between tabs and reloads.
// Nothing here is hardcoded except the course id preference list --
// CRNs change on every crawl, so sections are always resolved at runtime.

/**
 * Well-known introductory courses, in priority order.
 * Every one of these is skipped silently
 * if it is missing from the current term
 * or if none of its sections can actually be drawn on the calendar,
 * which is why the dynamic fallback below exists:
 * summer terms in particular have very few of these.
 */
const PREFERENCE_LIST = [
  'CS 124',
  'MATH 221',
  'RHET 105',
  'CS 225',
  'PSYC 100',
  'CHEM 102',
  'ECON 102',
  'PHYS 211',
  'MATH 231',
  'CMN 101',
  'STAT 100',
  'MCB 150',
  'IB 150',
  'ECE 120',
  'CS 173',
  'MATH 241',
  'PHYS 212',
  'ECON 103',
];

/**
 * Colors assigned to the sample courses (in order).
 * These are taken from `PALETTE` so that they look like colors a user
 * could have picked themselves. Unlike `getRandomColor`, they are stable,
 * which keeps the whole seed deterministic.
 */
export const SAMPLE_COLORS: string[] = [
  PALETTE[1]?.[9] ?? '#009CE0',
  PALETTE[1]?.[7] ?? '#68BC00',
  PALETTE[1]?.[4] ?? '#E27300',
  PALETTE[1]?.[10] ?? '#7B64FF',
];

const TARGET_COURSE_COUNT = 4;

// Seeding fewer than this many courses looks like a bug rather than a sample,
// so we prefer to seed nothing at all.
const MIN_COURSE_COUNT = 2;

// Upper bound on the number of combinations the seeded courses may produce
// once their pins are cleared (via "Reset Sections").
// `CombinationContainer` calls `Oscar.getCombinations` in a `useMemo`,
// and unpinned intro courses with dozens of sections each
// can reach tens of millions of combinations, which freezes the tab.
const COMBINATION_BUDGET = 1000000;

const EARLY_CUTOFF = 9 * 60;
const LATE_CUTOFF = 18 * 60;
const IDEAL_START = 10 * 60;

// A section scores below this only if it has no meeting before 9 AM
// and none ending after 6 PM (both of those add 200 on their own).
const COMFORTABLE_TOLERANCE = 200;

type DrawableMeeting = Meeting & { period: Period };

/**
 * Whether a meeting can actually be drawn on the calendar:
 * `Oscar` decodes 'TBA' periods to `undefined`
 * and 'ARRANGED' periods to `{ start: -1, end: -1 }`,
 * and days of '&nbsp;' to an empty array.
 * The calendar grid itself is a fixed `OPEN`--`CLOSE` range.
 */
function isDrawableMeeting(meeting: Meeting): meeting is DrawableMeeting {
  const { period } = meeting;
  return (
    period != null &&
    period.start >= OPEN &&
    period.end <= CLOSE &&
    period.end > period.start &&
    meeting.days.length > 0
  );
}

function drawableMeetings(section: Section): DrawableMeeting[] {
  return section.meetings.filter(isDrawableMeeting);
}

function isDrawable(section: Section): boolean {
  return section.meetings.some(isDrawableMeeting);
}

function drawableSectionCount(course: Course): number {
  return course.sections.filter(isDrawable).length;
}

/**
 * Ranks a section by how pleasant it is to see in a sample schedule
 * (lower is better), returning `Infinity` for sections
 * that can't be drawn on the calendar at all.
 */
function sectionScore(section: Section): number {
  const meetings = drawableMeetings(section);
  if (meetings.length === 0) return Number.POSITIVE_INFINITY;

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let dayCount = 0;
  meetings.forEach(({ period, days }) => {
    earliest = Math.min(earliest, period.start);
    latest = Math.max(latest, period.end);
    dayCount = Math.max(dayCount, days.length);
  });

  let score = 0;
  if (earliest < EARLY_CUTOFF) score += 200;
  if (latest > LATE_CUTOFF) score += 200;
  // A once-a-week section leaves the calendar looking emptier
  if (dayCount < 2) score += 100;
  // Online sections still draw (they have real days/times), just prefer others
  if (/Online/i.test(section.scheduleType)) score += 30;
  // Nudge towards mid-morning; at most ~50 either way
  score += Math.abs(earliest - IDEAL_START) / 10;
  return score;
}

function compareSections(a: Section, b: Section): number {
  const difference = sectionScore(a) - sectionScore(b);
  if (difference !== 0 && !Number.isNaN(difference)) return difference;
  // Break ties by id so the result never depends on input order
  return a.id.localeCompare(b.id);
}

function sortSections(sections: readonly Section[]): Section[] {
  return [...sections].sort(compareSections);
}

/**
 * Groups labs the same way `Oscar.getCombinations` does.
 * The two must agree, or the seeded pins won't collapse
 * to a single combination.
 */
function groupLabsByScheduleType(labs: Section[]): Section[][] {
  const groups: Record<string, Section[]> = {};
  labs.forEach((lab) => {
    const key = lab.scheduleType || 'unknown';
    const bucket = groups[key] ?? (groups[key] = []);
    bucket.push(lab);
  });
  // Sort by key so the group order is stable across runs
  return Object.keys(groups)
    .sort()
    .flatMap((key) => {
      const group = groups[key];
      return group == null ? [] : [group];
    });
}

function conflictsWithAny(
  oscar: Oscar,
  section: Section,
  crns: readonly string[]
): boolean {
  return crns.some((crn) => {
    const other = oscar.findSection(crn);
    if (other === undefined) return false;
    return hasConflictBetween(other, section);
  });
}

/**
 * Picks a complete, conflict-free set of sections for a single course:
 * one section for a normal course, or a lecture plus one lab
 * per lab schedule-type group for a course with labs.
 * Returns `null` if the course can't be scheduled
 * against the already-pinned CRNs within the given tolerance.
 */
function selectSectionsFor(
  oscar: Oscar,
  course: Course,
  pinnedCrns: readonly string[],
  tolerance: number
): string[] | null {
  const isAcceptable = (section: Section): boolean =>
    sectionScore(section) < tolerance;

  if (course.hasLab) {
    // If a course has a lab, then `onlyLectures`, `onlyLabs`, and `allInOnes`
    // should be non-undefined, but we have to check anyways here
    // to satisfy TypeScript
    const onlyLectures = course.onlyLectures ?? [];
    const onlyLabs = course.onlyLabs ?? [];
    const allInOnes = course.allInOnes ?? [];

    const selectWithLabs = (lecture: Section): string[] | null => {
      if (!isAcceptable(lecture)) return null;
      if (conflictsWithAny(oscar, lecture, pinnedCrns)) return null;

      const associatedLabCrns = new Set(
        lecture.associatedLabs.map((lab) => lab.crn)
      );
      const labGroups = groupLabsByScheduleType(onlyLabs).map((group) => {
        const associated = group.filter((lab) =>
          associatedLabCrns.has(lab.crn)
        );
        return sortSections(associated.length ? associated : group);
      });
      if (labGroups.length === 0) return null;

      const selected = [lecture.crn];
      const allSelected = (): string[] => [...pinnedCrns, ...selected];
      const complete = labGroups.every((group) => {
        const lab = group.find(
          (candidate) =>
            isAcceptable(candidate) &&
            !conflictsWithAny(oscar, candidate, allSelected())
        );
        if (lab === undefined) return false;
        selected.push(lab.crn);
        return true;
      });
      return complete ? selected : null;
    };

    for (const lecture of sortSections(onlyLectures)) {
      const selected = selectWithLabs(lecture);
      if (selected !== null) return selected;
    }

    for (const section of sortSections(allInOnes)) {
      if (
        isAcceptable(section) &&
        !conflictsWithAny(oscar, section, pinnedCrns)
      ) {
        return [section.crn];
      }
    }

    return null;
  }

  // For a course without labs, pinning any single section is enough:
  // `Oscar.getCombinations` short-circuits on `course.sections.some(isPinned)`
  for (const section of sortSections(course.sections)) {
    if (
      isAcceptable(section) &&
      !conflictsWithAny(oscar, section, pinnedCrns)
    ) {
      return [section.crn];
    }
  }

  return null;
}

// `branchingOf` walks every section of a course, and the fallback scan asks
// about the same courses several times, so memoize it per `Course` bean
// (the beans are rebuilt whenever new term data is loaded).
const branchingCache = new WeakMap<Course, number>();

/**
 * Cheap upper bound on the number of combinations a course contributes
 * once its pins are cleared.
 */
function branchingOf(course: Course): number {
  const cached = branchingCache.get(course);
  if (cached !== undefined) return cached;
  const branching = computeBranching(course);
  branchingCache.set(course, branching);
  return branching;
}

function computeBranching(course: Course): number {
  if (course.hasLab) {
    const lectures = (course.onlyLectures ?? []).filter(isDrawable);
    const labGroups = groupLabsByScheduleType(
      (course.onlyLabs ?? []).filter(isDrawable)
    );
    const labProduct = labGroups.reduce(
      (product, group) => product * Math.max(1, group.length),
      1
    );
    const allInOnes = (course.allInOnes ?? []).filter(isDrawable);
    return lectures.length * labProduct + allInOnes.length;
  }

  // Mirrors `Course.distinct`: sections with identical meeting times
  // collapse into a single option
  const hashes = new Set(
    course.sections
      .filter(isDrawable)
      .map((section) =>
        JSON.stringify(
          section.meetings.map(({ days, period }) => ({ days, period }))
        )
      )
  );
  return hashes.size;
}

type Candidate = {
  course: Course;
  level: number;
  drawableSections: number;
};

/**
 * All courses in the term that have at least one drawable section,
 * ranked by how likely they are to be a large, recognizable course.
 * The number of drawable sections is a decent proxy for that
 * without needing any data beyond the term JSON.
 */
function rankCandidates(oscar: Oscar): Candidate[] {
  const candidates = oscar.courses.flatMap<Candidate>((course) => {
    const drawableSections = drawableSectionCount(course);
    if (drawableSections === 0) return [];
    const parsedLevel = parseInt(course.number.replace(/\D/g, ''), 10);
    return [
      {
        course,
        level: Number.isNaN(parsedLevel)
          ? Number.POSITIVE_INFINITY
          : parsedLevel,
        drawableSections,
      },
    ];
  });

  return candidates.sort(
    (a, b) =>
      b.drawableSections - a.drawableSections ||
      a.level - b.level ||
      a.course.id.localeCompare(b.course.id)
  );
}

export type SampleSchedule = {
  courseIds: string[];
  crns: string[];
};

/**
 * Builds the sample schedule for a term:
 * a handful of courses along with a complete, conflict-free set of pinned
 * sections for them (the calendar only draws pinned CRNs,
 * so seeding courses without pins would leave it blank).
 *
 * Returns `null` when the term doesn't have enough schedulable courses,
 * in which case nothing should be seeded at all.
 */
export default function buildSampleSchedule(
  oscar: Oscar
): SampleSchedule | null {
  const courseIds: string[] = [];
  const crns: string[] = [];
  const subjects = new Set<string>();
  let branchingProduct = 1;

  const isWithinBudget = (course: Course): boolean =>
    branchingProduct * Math.max(1, branchingOf(course)) <= COMBINATION_BUDGET;

  const add = (course: Course, selectedCrns: string[]): void => {
    courseIds.push(course.id);
    crns.push(...selectedCrns);
    subjects.add(course.subject);
    branchingProduct *= Math.max(1, branchingOf(course));
  };

  const isFull = (): boolean => courseIds.length >= TARGET_COURSE_COUNT;

  const ranked = rankCandidates(oscar);

  // First pass over each tolerance prefers the curated list (recognizable
  // courses); the second falls back to whatever the term actually offers,
  // widening the course-level window as needed.
  // The second tolerance tier accepts anything that can be drawn at all,
  // which is what keeps a sparse summer term usable.
  for (const tolerance of [COMFORTABLE_TOLERANCE, Number.POSITIVE_INFINITY]) {
    for (const courseId of PREFERENCE_LIST) {
      const course = oscar.findCourse(courseId);
      if (
        !isFull() &&
        course !== undefined &&
        !courseIds.includes(course.id) &&
        isWithinBudget(course)
      ) {
        const selected = selectSectionsFor(oscar, course, crns, tolerance);
        if (selected !== null) add(course, selected);
      }
    }

    for (const maxLevel of [300, 500, Number.POSITIVE_INFINITY]) {
      for (const { course, level } of ranked) {
        if (
          !isFull() &&
          level < maxLevel &&
          !courseIds.includes(course.id) &&
          !subjects.has(course.subject) &&
          isWithinBudget(course)
        ) {
          const selected = selectSectionsFor(oscar, course, crns, tolerance);
          if (selected !== null) add(course, selected);
        }
      }
    }
  }

  if (courseIds.length < MIN_COURSE_COUNT) return null;
  return { courseIds, crns };
}
