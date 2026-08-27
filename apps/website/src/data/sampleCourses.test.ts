import Oscar, { EMPTY_OSCAR } from './beans/Oscar';
import buildSampleSchedule from './sampleCourses';
import {
  CrawlerCourse,
  CrawlerSection,
  CrawlerTermData,
  CrawlerMeeting,
} from '../types';

// Indices into the caches below
const NINE_AM = 0;
const TEN_AM = 1;
const ELEVEN_AM = 2;
const TBA = 3;
const ARRANGED = 4;

const LECTURE = 0;

function makeMeeting(periodIndex: number, days: string): CrawlerMeeting {
  return [periodIndex, days, 'Somewhere 101', -1, ['Doe, Jane'], 0, -1, -1];
}

function makeSection(crn: string, meetings: CrawlerMeeting[]): CrawlerSection {
  return [crn, meetings, 3, LECTURE, 0, [], 0];
}

function makeCourse(
  title: string,
  sections: Record<string, CrawlerSection>
): CrawlerCourse {
  return [title, sections, undefined, null];
}

function makeOscar(courses: Record<string, CrawlerCourse>): Oscar {
  const data: CrawlerTermData = {
    courses,
    caches: {
      periods: ['900 - 950', '1000 - 1050', '1100 - 1150', 'TBA', 'ARRANGED'],
      dateRanges: ['Aug 17, 2020 - Dec 10, 2020'],
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

describe('buildSampleSchedule', () => {
  it('seeds nothing for a term with no courses', () => {
    expect(buildSampleSchedule(EMPTY_OSCAR)).toBeNull();
  });

  it('seeds nothing when only one course can be drawn', () => {
    const oscar = makeOscar({
      'AAA 101': makeCourse('Only Course', {
        A: makeSection('10001', [makeMeeting(NINE_AM, 'MWF')]),
      }),
      // Neither of these can be shown on the calendar
      'BBB 102': makeCourse('Time TBA', {
        A: makeSection('10002', [makeMeeting(TBA, 'MWF')]),
      }),
      'CCC 103': makeCourse('Arranged', {
        A: makeSection('10003', [makeMeeting(ARRANGED, '&nbsp;')]),
      }),
    });
    expect(buildSampleSchedule(oscar)).toBeNull();
  });

  it('seeds courses that are not in the preference list', () => {
    const oscar = makeOscar({
      'AAA 101': makeCourse('First', {
        A: makeSection('10001', [makeMeeting(NINE_AM, 'MWF')]),
        B: makeSection('10002', [makeMeeting(TEN_AM, 'MWF')]),
      }),
      'BBB 102': makeCourse('Second', {
        A: makeSection('10003', [makeMeeting(ELEVEN_AM, 'TR')]),
      }),
    });

    const sampleSchedule = buildSampleSchedule(oscar);
    expect(sampleSchedule).not.toBeNull();
    expect(sampleSchedule?.courseIds).toEqual(['AAA 101', 'BBB 102']);
    // Pinning a full combination is what makes the calendar non-empty,
    // and collapses the combination list down to that one schedule
    expect(sampleSchedule?.crns).toHaveLength(2);
    expect(
      oscar.getCombinations(
        sampleSchedule?.courseIds ?? [],
        sampleSchedule?.crns ?? [],
        [],
        []
      )
    ).toHaveLength(1);
  });

  it('never pins conflicting sections', () => {
    const oscar = makeOscar({
      'AAA 101': makeCourse('First', {
        A: makeSection('10001', [makeMeeting(NINE_AM, 'MWF')]),
      }),
      // Only overlapping options; this course has to be skipped
      'BBB 102': makeCourse('Second', {
        A: makeSection('10002', [makeMeeting(NINE_AM, 'MW')]),
      }),
      'CCC 103': makeCourse('Third', {
        A: makeSection('10003', [makeMeeting(TEN_AM, 'MWF')]),
      }),
    });

    expect(buildSampleSchedule(oscar)?.courseIds).toEqual([
      'AAA 101',
      'CCC 103',
    ]);
  });

  it('is deterministic', () => {
    const oscar = makeOscar({
      'AAA 101': makeCourse('First', {
        A: makeSection('10001', [makeMeeting(NINE_AM, 'MWF')]),
        B: makeSection('10002', [makeMeeting(TEN_AM, 'MWF')]),
      }),
      'BBB 102': makeCourse('Second', {
        A: makeSection('10003', [makeMeeting(ELEVEN_AM, 'TR')]),
      }),
    });

    expect(buildSampleSchedule(oscar)).toEqual(buildSampleSchedule(oscar));
  });
});
