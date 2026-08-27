import React, { useCallback, useContext, useMemo } from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import Banner from '../Banner';
import { ScheduleContext } from '../../contexts';
import { DESKTOP_BREAKPOINT } from '../../constants';
import {
  SAMPLE_BANNER_LOCAL_STORAGE_KEY,
  SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
  SampleScheduleRecord,
  asSeededSampleSchedule,
  defaultSampleScheduleRecord,
} from '../../data/sampleSchedule';
import useScreenWidth from '../../hooks/useScreenWidth';
import { ErrorWithFields, softError } from '../../log';

import './stylesheet.scss';

function Content(): React.ReactElement {
  return (
    <span className="sample-banner-message" role="status">
      <strong>These are sample courses.</strong> We started your schedule with a
      few examples so you can see how it works &mdash; add your own and remove
      the ones you don&apos;t need.
    </span>
  );
}

function MobileContent(): React.ReactElement {
  return (
    <span className="sample-banner-message" role="status">
      <strong>These are sample courses.</strong> Add your own, or clear them.
    </span>
  );
}

/**
 * Tells a first-time visitor that the courses already in their schedule
 * were added for them, and gives them a single action to take them back out.
 * The sample courses themselves are seeded much earlier,
 * by `StageSeedSampleSchedule` in the app data loader.
 *
 * Dismissing the banner (the X) deliberately keeps the courses,
 * since by then the user may have started editing the sample schedule;
 * only the clear action removes them.
 */
export default function SampleCoursesBanner(): React.ReactElement {
  const [
    {
      term,
      currentVersion,
      oscar,
      desiredCourses,
      pinnedCrns,
      excludedCrns,
      colorMap,
    },
    { patchSchedule },
  ] = useContext(ScheduleContext);
  const mobile = !useScreenWidth(DESKTOP_BREAKPOINT);

  const [sampleScheduleRecord, setSampleScheduleRecord] =
    useLocalStorageState<SampleScheduleRecord>(
      SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
      { defaultValue: defaultSampleScheduleRecord, storageSync: true }
    );

  // The sample courses that are still actually in the schedule.
  // Anything the user has already removed by hand is not "re-removed",
  // and the banner disappears on its own once they are all gone.
  const remainingSampleCourseIds = useMemo<string[]>(() => {
    const seeded = asSeededSampleSchedule(sampleScheduleRecord);
    if (seeded === null) return [];
    // The seed only ever went into one term & version,
    // so don't offer to clear it from anywhere else
    if (seeded.term !== term || seeded.version !== currentVersion) return [];
    return seeded.courseIds.filter((courseId) =>
      desiredCourses.includes(courseId)
    );
  }, [sampleScheduleRecord, term, currentVersion, desiredCourses]);

  const handleClear = useCallback((): void => {
    try {
      const sampleCourseIds = new Set(remainingSampleCourseIds);
      const sampleCrns = new Set(
        remainingSampleCourseIds.flatMap(
          (courseId) =>
            oscar
              .findCourse(courseId)
              ?.sections.map((section) => section.crn) ?? []
        )
      );

      const newColorMap = { ...colorMap };
      sampleCourseIds.forEach((courseId) => {
        delete newColorMap[courseId];
      });

      patchSchedule({
        desiredCourses: desiredCourses.filter(
          (courseId) => !sampleCourseIds.has(courseId)
        ),
        pinnedCrns: pinnedCrns.filter((crn) => !sampleCrns.has(crn)),
        excludedCrns: excludedCrns.filter((crn) => !sampleCrns.has(crn)),
        colorMap: newColorMap,
      });
      setSampleScheduleRecord({ status: 'cleared' });
    } catch (err) {
      softError(
        new ErrorWithFields({
          message: 'could not clear the sample courses',
          source: err,
          fields: {
            term,
            currentVersion,
            remainingSampleCourseIds,
          },
        })
      );
    }
  }, [
    remainingSampleCourseIds,
    oscar,
    colorMap,
    desiredCourses,
    pinnedCrns,
    excludedCrns,
    patchSchedule,
    setSampleScheduleRecord,
    term,
    currentVersion,
  ]);

  if (remainingSampleCourseIds.length === 0) return <div />;

  return (
    <Banner
      className="banner--sample-courses"
      localStorageKey={SAMPLE_BANNER_LOCAL_STORAGE_KEY}
      dismissLabel="Dismiss sample course notice"
      content={
        <>
          <FontAwesomeIcon
            className="sample-banner-icon"
            fixedWidth
            icon={faCircleInfo}
            aria-hidden
          />
          <Content />
        </>
      }
      mobileContent={
        <>
          <FontAwesomeIcon
            className="sample-banner-icon"
            fixedWidth
            icon={faCircleInfo}
            aria-hidden
          />
          <MobileContent />
        </>
      }
      action={
        <button
          type="button"
          className="sample-banner-clear"
          aria-label="Clear sample courses"
          onClick={handleClear}
        >
          {mobile ? 'Clear' : 'Clear sample courses'}
        </button>
      }
    />
  );
}
