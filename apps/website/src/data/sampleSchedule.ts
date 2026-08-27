// The contract shared by the stage that seeds a first-time visitor's schedule
// with sample courses (`useSeedSampleSchedule`) and the banner that tells them
// about it (`components/SampleCoursesBanner`).
// Both keys are versioned independently of `LATEST_SCHEDULE_DATA_VERSION`
// so that the sample set can be revised later by bumping the suffix
// without touching the schedule data schema.

export const SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY = 'sample-schedule-v1';
export const SAMPLE_BANNER_LOCAL_STORAGE_KEY = 'sample-schedule-banner-v1';

export type SeededSampleSchedule = {
  status: 'seeded';
  seededAt: string;
  term: string;
  version: string;
  courseIds: string[];
};

/**
 * Tracks whether this browser has had its schedule auto-populated with sample
 * courses. The record doubles as the "first visit" flag: any status other than
 * `'none'` means the seeding decision has already been made for this browser
 * and must never be made again (otherwise deleting the last course in a
 * schedule would look exactly like a first visit and re-seed on top of it).
 *
 * - `'none'`: never evaluated (a first visit).
 * - `'seeded'`: sample courses were added; the banner is eligible to show.
 * - `'skipped'`: evaluated, but deliberately not seeded
 *   (the user already had data, or the term had nothing schedulable).
 * - `'cleared'`: the user removed the samples with the banner's clear action.
 */
export type SampleScheduleRecord =
  | { status: 'none' }
  | { status: 'skipped' }
  | { status: 'cleared' }
  | SeededSampleSchedule;

export const defaultSampleScheduleRecord: SampleScheduleRecord = {
  status: 'none',
};

/**
 * Narrows a record read out of local storage to the seeded variant,
 * returning `null` for every other status as well as for anything a corrupt
 * or older version of the app might have left behind under the same key.
 */
export function asSeededSampleSchedule(
  record: SampleScheduleRecord | null | undefined
): SeededSampleSchedule | null {
  if (record == null || record.status !== 'seeded') return null;
  if (!Array.isArray(record.courseIds)) return null;
  return record;
}
