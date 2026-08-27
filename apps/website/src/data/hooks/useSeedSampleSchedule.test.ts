import { renderHook } from '@testing-library/react';
import produce from 'immer';

import useSeedSampleSchedule, {
  isScheduleDataEmpty,
} from './useSeedSampleSchedule';
import Oscar, { EMPTY_OSCAR } from '../beans/Oscar';
import {
  SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
  SampleScheduleRecord,
} from '../sampleSchedule';
import { CrawlerCourse, CrawlerMeeting, CrawlerTermData } from '../../types';
import { ScheduleData, ScheduleVersion } from '../types';

const emptyVersion: ScheduleVersion = {
  name: 'Primary',
  friends: {},
  createdAt: '2020-01-01T00:00:00.000Z',
  schedule: {
    desiredCourses: [],
    pinnedCrns: [],
    excludedCrns: [],
    events: [],
    colorMap: {},
    sortingOptionIndex: 0,
  },
};

function makeScheduleData(
  versions: Record<string, Record<string, ScheduleVersion>>
): ScheduleData {
  const terms: ScheduleData['terms'] = {};
  Object.entries(versions).forEach(([term, termVersions]) => {
    terms[term] = { versions: termVersions };
  });
  return { terms, version: 3 };
}

describe('isScheduleDataEmpty', () => {
  it('is true when there are no terms at all', () => {
    expect(isScheduleDataEmpty(makeScheduleData({}))).toBe(true);
  });

  it('is true for the empty version the loader creates on a new term', () => {
    expect(
      isScheduleDataEmpty(
        makeScheduleData({ '202608': { sv_a: emptyVersion } })
      )
    ).toBe(true);
  });

  it('is false when a *different* term has data', () => {
    // This is the case that a current-term-only check would get wrong:
    // switching to a term the user has never opened
    // always looks empty for that term alone
    expect(
      isScheduleDataEmpty(
        makeScheduleData({
          '202608': { sv_a: emptyVersion },
          '202605': {
            sv_b: {
              ...emptyVersion,
              schedule: {
                ...emptyVersion.schedule,
                desiredCourses: ['CS 124'],
              },
            },
          },
        })
      )
    ).toBe(false);
  });

  it('is false when there is more than one version', () => {
    expect(
      isScheduleDataEmpty(
        makeScheduleData({
          '202608': { sv_a: emptyVersion, sv_b: emptyVersion },
        })
      )
    ).toBe(false);
  });

  it('is false when the only version was renamed', () => {
    expect(
      isScheduleDataEmpty(
        makeScheduleData({
          '202608': { sv_a: { ...emptyVersion, name: 'My Schedule' } },
        })
      )
    ).toBe(false);
  });

  it('is false for pinned sections, events, or colors', () => {
    const partialSchedules: Partial<ScheduleVersion['schedule']>[] = [
      { pinnedCrns: ['10001'] },
      {
        events: [
          {
            id: 'event',
            name: 'Work',
            period: { start: 540, end: 600 },
            days: ['M'],
          },
        ],
      },
      { colorMap: { 'CS 124': '#333333' } },
    ];

    partialSchedules.forEach((partialSchedule) => {
      expect(
        isScheduleDataEmpty(
          makeScheduleData({
            '202608': {
              sv_a: {
                ...emptyVersion,
                schedule: { ...emptyVersion.schedule, ...partialSchedule },
              },
            },
          })
        )
      ).toBe(false);
    });
  });

  it('is false when the schedule has been shared with a friend', () => {
    expect(
      isScheduleDataEmpty(
        makeScheduleData({
          '202608': {
            sv_a: {
              ...emptyVersion,
              friends: {
                friend: { status: 'Accepted', email: 'friend@illinois.edu' },
              },
            },
          },
        })
      )
    ).toBe(false);
  });
});

// The tests below cover the seeding decision itself
// (rather than the `isScheduleDataEmpty` predicate it is built on).
// The gate that matters most is local storage, not the emptiness check:
// a user who removes their last course looks byte-identical to a new user,
// so only the stored record keeps them from being seeded a second time.

function makeOscar(): Oscar {
  const meeting: CrawlerMeeting = [
    0,
    'MWF',
    'Somewhere 101',
    -1,
    ['Doe, Jane'],
    0,
    -1,
    -1,
  ];
  const later: CrawlerMeeting = [
    1,
    'MWF',
    'Somewhere 102',
    -1,
    ['Doe, Jane'],
    0,
    -1,
    -1,
  ];
  const courses: Record<string, CrawlerCourse> = {
    'AAA 101': [
      'Course One',
      { A: ['10001', [meeting], 3, 0, 0, [], 0] },
      [],
      null,
    ],
    'BBB 101': [
      'Course Two',
      { A: ['10002', [later], 3, 0, 0, [], 0] },
      [],
      null,
    ],
  };
  const data: CrawlerTermData = {
    courses,
    caches: {
      periods: ['900 - 950', '1000 - 1050'],
      dateRanges: ['Aug 17, 2026 - Dec 10, 2026'],
      scheduleTypes: ['Lecture'],
      campuses: ['Urbana-Champaign'],
      attributes: [],
      gradeBases: ['Letter Graded'],
      locations: [],
      finalDates: [],
      finalTimes: [],
      fullCourseNames: {},
    },
    updatedAt: JSON.parse(JSON.stringify(new Date())) as string,
    version: 3,
  };
  return new Oscar(data, '202608');
}

/**
 * Renders the hook against a mutable schedule version,
 * returning both the hook result and whatever was written to it.
 */
function renderSeed(scheduleData: ScheduleData): {
  written: ScheduleVersion;
  updates: number;
} {
  const oscar = makeOscar();
  let written: ScheduleVersion = {
    ...emptyVersion,
    schedule: { ...emptyVersion.schedule },
  };
  let updates = 0;

  renderHook(() =>
    useSeedSampleSchedule({
      oscar,
      scheduleData,
      currentTerm: '202608',
      currentVersion: 'sv_a',
      updateScheduleVersion: (applyDraft): void => {
        updates += 1;
        written = produce(written, (draft) => {
          applyDraft(draft);
        });
      },
    })
  );

  return { written, updates };
}

describe('useSeedSampleSchedule', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('seeds courses and pins on a genuine first visit', () => {
    const { written, updates } = renderSeed(
      makeScheduleData({ '202608': { sv_a: emptyVersion } })
    );

    expect(updates).toBe(1);
    expect(written.schedule.desiredCourses.length).toBeGreaterThan(0);
    // The calendar only draws pinned CRNs, so a seed without pins
    // would leave a brand-new user staring at an empty grid
    expect(written.schedule.pinnedCrns.length).toBeGreaterThan(0);
    expect(Object.keys(written.schedule.colorMap).length).toBe(
      written.schedule.desiredCourses.length
    );

    const record = JSON.parse(
      window.localStorage.getItem(SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY) ?? 'null'
    ) as SampleScheduleRecord;
    expect(record.status).toBe('seeded');
  });

  it('does not seed a user who deleted their last course', () => {
    // Their schedule is empty again, so only the stored record
    // distinguishes them from a first-time visitor
    window.localStorage.setItem(
      SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        status: 'seeded',
        seededAt: '2026-01-01T00:00:00.000Z',
        term: '202608',
        version: 'sv_a',
        courseIds: ['AAA 101'],
      })
    );

    const { updates } = renderSeed(
      makeScheduleData({ '202608': { sv_a: emptyVersion } })
    );

    expect(updates).toBe(0);
  });

  it.each(['skipped', 'cleared'] as const)(
    'does not seed again once the decision was recorded as %s',
    (status) => {
      window.localStorage.setItem(
        SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY,
        JSON.stringify({ status })
      );

      const { updates } = renderSeed(
        makeScheduleData({ '202608': { sv_a: emptyVersion } })
      );

      expect(updates).toBe(0);
    }
  );

  it('does not seed on top of a user who already has data', () => {
    const { updates } = renderSeed(
      makeScheduleData({
        '202608': { sv_a: emptyVersion },
        '202605': {
          sv_b: {
            ...emptyVersion,
            schedule: {
              ...emptyVersion.schedule,
              desiredCourses: ['CS 124'],
            },
          },
        },
      })
    );

    expect(updates).toBe(0);
    // The decision is still recorded, so it is never re-evaluated
    const record = JSON.parse(
      window.localStorage.getItem(SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY) ?? 'null'
    ) as SampleScheduleRecord;
    expect(record.status).toBe('skipped');
  });

  it('records a decision even when the term has nothing to seed', () => {
    const oscar = EMPTY_OSCAR;
    let updates = 0;
    renderHook(() =>
      useSeedSampleSchedule({
        oscar,
        scheduleData: makeScheduleData({ '202608': { sv_a: emptyVersion } }),
        currentTerm: '202608',
        currentVersion: 'sv_a',
        updateScheduleVersion: (): void => {
          updates += 1;
        },
      })
    );

    expect(updates).toBe(0);
    const record = JSON.parse(
      window.localStorage.getItem(SAMPLE_SCHEDULE_LOCAL_STORAGE_KEY) ?? 'null'
    ) as SampleScheduleRecord;
    expect(record.status).toBe('skipped');
  });
});
