import { Draft, Immutable } from 'immer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useLocalStorageState from 'use-local-storage-state';

import { Oscar } from '../beans';
import buildSampleSchedule, {
  SampleSchedule,
  SAMPLE_COLORS,
} from '../sampleCourses';
import {
  SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
  SampleScheduleRecord,
  defaultSampleScheduleRecord,
} from '../sampleSchedule';
import { ScheduleData, ScheduleVersion } from '../types';
import { ErrorWithFields, softError } from '../../log';
import { LoadingState } from '../../types';
import { PRIMARY_VERSION_NAME } from '../../utils/misc';

/**
 * Whether the user has no schedule data anywhere:
 * no courses, no pinned sections, no custom events, no colors,
 * no shared schedules, and no extra schedule versions.
 *
 * This deliberately looks at **every** term rather than the current one:
 * the loading stages fabricate an empty term
 * (and an empty 'Primary' version inside it)
 * for any term the user hasn't visited before,
 * so "the current term is empty" is true
 * for every existing user the moment they switch to a new term.
 *
 * `sortingOptionIndex` and `excludedCrns` are deliberately not checked:
 * they can both be changed by UI toggles without adding any real data.
 */
export function isScheduleDataEmpty(
  scheduleData: Immutable<ScheduleData>
): boolean {
  return Object.values(scheduleData.terms).every((termScheduleData) => {
    const versions = Object.values(termScheduleData?.versions ?? {});
    // Having more than one version is itself evidence of use
    if (versions.length > 1) return false;
    return versions.every((scheduleVersion) => {
      if (scheduleVersion == null) return true;
      // A renamed version means the user has been here
      if (scheduleVersion.name !== PRIMARY_VERSION_NAME) return false;
      const { schedule } = scheduleVersion;
      return (
        schedule.desiredCourses.length === 0 &&
        schedule.pinnedCrns.length === 0 &&
        schedule.events.length === 0 &&
        Object.keys(schedule.colorMap).length === 0 &&
        Object.keys(scheduleVersion.friends ?? {}).length === 0
      );
    });
  });
}

/**
 * Populates a brand-new user's schedule with a few sample courses
 * (and a conflict-free set of pinned sections for them)
 * so that the app opens on a filled-in calendar instead of an empty grid.
 *
 * This runs at most once per browser, gated on a local storage record
 * that is written on both the seeded and the skipped path,
 * so that switching terms (which re-mounts this hook
 * against a freshly-fabricated empty schedule version) never re-evaluates it.
 * The record is what keeps a user who deletes their last course
 * from being re-seeded: at that point their data looks brand new.
 *
 * Because this hook lives below every stage that loads user data,
 * a signed-in user's Firestore document has already been read and migrated
 * by the time the emptiness check runs; it never races against it.
 *
 * One known consequence of gating on local storage: signing out clears all of
 * local storage, including this record, so a signed-out user starts over with
 * an empty local schedule and gets seeded again. Their account data lives in
 * Firestore and is untouched.
 */
export default function useSeedSampleSchedule({
  oscar,
  scheduleData,
  currentTerm,
  currentVersion,
  updateScheduleVersion,
}: {
  oscar: Oscar;
  scheduleData: Immutable<ScheduleData>;
  currentTerm: string;
  currentVersion: string;
  updateScheduleVersion: (
    applyDraft: (
      draft: Draft<ScheduleVersion>
    ) => void | Immutable<ScheduleVersion>
  ) => void;
}): LoadingState<Record<string, never>> {
  const [sampleScheduleRecord, setSampleScheduleRecord] =
    useLocalStorageState<SampleScheduleRecord>(
      SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
      { defaultValue: defaultSampleScheduleRecord, storageSync: true }
    );

  // Snapshot the decision as of the first render of this stage
  // (the record is read from local storage synchronously).
  // Everything else this depends on is already loaded,
  // so the decision can be made before anything is rendered,
  // which avoids showing an empty scheduler
  // that then pops full of courses a moment later.
  const [wasUnevaluated] = useState<boolean>(
    () => sampleScheduleRecord.status === 'none'
  );

  const sampleSchedule = useMemo<SampleSchedule | null>(() => {
    if (!wasUnevaluated) return null;
    try {
      return buildSampleSchedule(oscar);
    } catch (err) {
      softError(
        new ErrorWithFields({
          message: 'could not build the sample schedule; skipping it',
          source: err,
          fields: { term: oscar.term },
        })
      );
      return null;
    }
  }, [wasUnevaluated, oscar]);

  const shouldSeed =
    wasUnevaluated &&
    sampleSchedule !== null &&
    isScheduleDataEmpty(scheduleData);

  const [hasEvaluated, setHasEvaluated] = useState<boolean>(false);
  // A ref (rather than state) so that the seed still only happens once
  // when React double-invokes effects in development
  const hasRun = useRef<boolean>(false);

  const seed = useCallback(
    (schedule: SampleSchedule): void => {
      const colorMap: Record<string, string> = {};
      schedule.courseIds.forEach((courseId, index) => {
        colorMap[courseId] =
          SAMPLE_COLORS[index % SAMPLE_COLORS.length] ?? '#333333';
      });

      updateScheduleVersion((draft) => {
        // Assign rather than append so that two tabs seeding at the same time
        // can't produce duplicate courses
        draft.schedule.desiredCourses = [...schedule.courseIds];
        draft.schedule.pinnedCrns = [...schedule.crns];
        draft.schedule.excludedCrns = [];
        draft.schedule.colorMap = colorMap;
      });
    },
    [updateScheduleVersion]
  );

  useEffect(() => {
    if (!wasUnevaluated || hasRun.current) return;
    hasRun.current = true;

    if (!shouldSeed || sampleSchedule === null) {
      // Either the user already has data
      // or the term has nothing worth seeding.
      // Record the decision anyways so it is never made again.
      setSampleScheduleRecord({ status: 'skipped' });
      setHasEvaluated(true);
      return;
    }

    try {
      seed(sampleSchedule);
      setSampleScheduleRecord({
        status: 'seeded',
        seededAt: new Date().toISOString(),
        term: currentTerm,
        version: currentVersion,
        courseIds: [...sampleSchedule.courseIds],
      });
    } catch (err) {
      softError(
        new ErrorWithFields({
          message: 'could not seed the sample schedule; continuing empty',
          source: err,
          fields: {
            term: currentTerm,
            currentVersion,
            courseIds: sampleSchedule.courseIds,
          },
        })
      );
      setSampleScheduleRecord({ status: 'skipped' });
    }

    setHasEvaluated(true);
  }, [
    wasUnevaluated,
    shouldSeed,
    sampleSchedule,
    currentTerm,
    currentVersion,
    seed,
    setSampleScheduleRecord,
  ]);

  // Withhold a single render pass, and only when actually seeding,
  // so the courses are already there the first time the app is drawn.
  // Gating on whether the attempt was made (rather than on the schedule
  // itself) means a failed write un-gates instead of hanging on the skeleton.
  if (shouldSeed && !hasEvaluated) return { type: 'loading' };
  return { type: 'loaded', result: {} };
}
