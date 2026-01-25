import { decode } from 'html-entities';

import { Oscar, Section } from '.';
import {
  CourseGpa,
  CrawlerCourse,
  CrawlerPrerequisites,
  Period,
} from '../../types';
import {
  hasConflictBetween,
  isLab,
  isLecture,
} from '../../utils/misc';
import { ErrorWithFields, softError } from '../../log';

const GPA_CACHE_LOCAL_STORAGE_KEY = 'course-gpa-cache-2';
const GPA_CACHE_EXPIRATION_DURATION_DAYS = 7;

interface SectionGroupMeeting {
  days: string[];
  period: Period | undefined;
}

interface SectionGroup {
  /**
   * Equal to`JSON.stringify(this.sectionGroupMeetings)`
   */
  hash: string;
  meetings: SectionGroupMeeting[];
  sections: Section[];
}

export default class Course {
  id: string;

  subject: string;

  number: string;

  title: string;

  sections: Section[];

  prereqs: CrawlerPrerequisites | undefined;

  hasLab: boolean;

  onlyLectures: Section[] | undefined;

  onlyLabs: Section[] | undefined;

  allInOnes: Section[] | undefined;

  sectionGroups: Record<string, SectionGroup> | undefined;

  term: string;

  constructor(oscar: Oscar, courseId: string, data: CrawlerCourse) {
    this.term = oscar.term;
    const [title, sections, prereqs] = data;

    this.id = courseId;
    const [subject, number] = this.id.split(' ');
    if (subject == null || number == null) {
      throw new ErrorWithFields({
        message: 'course ID could not be parsed',
        fields: {
          id: this.id,
          subject,
          number,
          term: this.term,
        },
      });
    }
    this.subject = subject;
    this.number = number;

    this.title = decode(title);
    this.sections = Object.entries(sections).flatMap<Section>(
      ([sectionId, sectionData]) => {
        if (sectionData == null) return [];
        try {
          return [new Section(oscar, this, sectionId, sectionData)];
        } catch (err) {
          softError(
            new ErrorWithFields({
              message: 'could not construct Section bean',
              source: err,
              fields: {
                courseId,
                term: this.term,
              },
            })
          );
          return [];
        }
      }
    );
    this.prereqs = prereqs;

    const onlyLectures = this.sections.filter(
      (section) => isLecture(section) && !isLab(section)
    );
    const onlyLabs = this.sections.filter(
      (section) => isLab(section) && !isLecture(section)
    );
    this.hasLab = !!onlyLectures.length && !!onlyLabs.length;
    if (this.hasLab) {
      const matchLabFromId = (lab: Section, lecture: Section): boolean =>
        // note: checking both ways because GT registrar
        // reversed studio and lecture sections for MATH 1553
        lecture.id.startsWith(lab.id) || lab.id.startsWith(lecture.id);
      const matchLabFromInstructors = (
        lab: Section,
        lecture: Section
      ): boolean =>
        // match lecture and lab sections
        // if there are *any* matching instructors
        // fixes issue with PHYS 2211 and 2212
        // no longer matching section id letters
        lab.instructors.filter((instructor) =>
          lecture.instructors.includes(instructor)
        ).length > 0;

      for (const lecture of onlyLectures) {
        lecture.associatedLabs = onlyLabs.filter((lab) =>
          matchLabFromId(lab, lecture)
        );
        // if no matching section id letters found, match by profs
        if (!lecture.associatedLabs.length) {
          lecture.associatedLabs = onlyLabs.filter(
            (lab) =>
              matchLabFromInstructors(lab, lecture) &&
              !hasConflictBetween(lab, lecture)
          );
        }
      }
      for (const lab of onlyLabs) {
        lab.associatedLectures = onlyLectures.filter((lecture) =>
          matchLabFromId(lab, lecture)
        );
        if (!lab.associatedLectures.length) {
          lab.associatedLectures = onlyLectures.filter(
            (lecture) =>
              matchLabFromInstructors(lab, lecture) &&
              !hasConflictBetween(lecture, lab)
          );
        }
      }
      const lonelyLectures = onlyLectures.filter(
        (lecture) => !lecture.associatedLabs.length
      );
      const lonelyLabs = onlyLabs.filter(
        (lab) => !lab.associatedLectures.length
      );
      for (const lecture of lonelyLectures) {
        lecture.associatedLabs = lonelyLabs.filter(
          (lab) => !hasConflictBetween(lecture, lab)
        );
      }
      for (const lab of lonelyLabs) {
        lab.associatedLectures = lonelyLectures.filter(
          (lecture) => !hasConflictBetween(lecture, lab)
        );
      }
      this.onlyLectures = onlyLectures;
      this.onlyLabs = onlyLabs;
      this.allInOnes = this.sections.filter(
        (section) => isLecture(section) && isLab(section)
      );
    } else {
      this.sectionGroups = this.distinct(this.sections);
    }
  }

  distinct(sections: Section[]): Record<string, SectionGroup> {
    const groups: Record<string, SectionGroup> = {};
    sections.forEach((section) => {
      const sectionGroupMeetings = section.meetings.map<SectionGroupMeeting>(
        ({ days, period }) => ({
          days,
          period,
        })
      );
      const sectionGroupHash = JSON.stringify(sectionGroupMeetings);
      const sectionGroup = groups[sectionGroupHash];
      if (sectionGroup) {
        sectionGroup.sections.push(section);
      } else {
        groups[sectionGroupHash] = {
          hash: sectionGroupHash,
          meetings: sectionGroupMeetings,
          sections: [section],
        };
      }
    });
    return groups;
  }

  async fetchGpa(): Promise<CourseGpa> {
    // Note: if `CourseGpa` ever changes,
    // the cache needs to be invalidated
    // (by changing the local storage key).
    type GpaCache = Record<string, GpaCacheItem>;
    interface GpaCacheItem {
      d: CourseGpa;
      exp: string;
    }

    // Cache lookup temporarily disabled for debugging
    // try {
    //   const rawCache = window.localStorage.getItem(GPA_CACHE_LOCAL_STORAGE_KEY);
    //   if (rawCache != null) {
    //     const cache: GpaCache = JSON.parse(rawCache) as unknown as GpaCache;
    //     const cacheItem = cache[this.id];
    //     if (cacheItem != null) {
    //       const now = new Date().toISOString();
    //       // Use lexicographic comparison on date strings
    //       // (since they are ISO 8601)
    //       if (now < cacheItem.exp) {
    //         return cacheItem.d;
    //       }
    //     }
    //   }
    // } catch (err) {
    //   // Ignore
    // }

    // Fetch the GPA normally
    const courseGpa = await this.fetchGpaInner();
    if (courseGpa === null) {
      // There was a failure; don't store the value in the cache.
      return {};
    }

    // Store the GPA in the cache
    const exp = new Date();
    exp.setDate(exp.getDate() + GPA_CACHE_EXPIRATION_DURATION_DAYS);
    try {
      let cache: GpaCache = {};
      const rawCache = window.localStorage.getItem(GPA_CACHE_LOCAL_STORAGE_KEY);
      if (rawCache != null) {
        cache = JSON.parse(rawCache) as unknown as GpaCache;
      }

      cache[this.id] = { d: courseGpa, exp: exp.toISOString() };
      const rawUpdatedCache = JSON.stringify(cache);
      window.localStorage.setItem(GPA_CACHE_LOCAL_STORAGE_KEY, rawUpdatedCache);
    } catch (err) {
      // Ignore
    }

    return courseGpa;
  }

  /**
   * Fetches the course GPA without caching it
   * @see `fetchGpa` for the persistent-caching version
   * @returns the course GPA if successfully fetched from course critique,
   * or `null` if there was a problem.
   * Note that the empty object `{}` is a valid course GPA value,
   * but we prefer returning `null` if there was a failure
   * so we can avoid storing the empty GPA value in the persistent cache.
   */

  private async fetchGpaInner(): Promise<CourseGpa | null> {
    type GpaEntry = {
      last: string;
      first: string;
      gpa: number;
    };
    type GpaData = Record<string, GpaEntry[]>;

    const courseKey = `${this.subject} ${this.number.replace(
      /\D/g,
      ''
    )}`.trim();

    const win = window as Window & { gpaDataCache?: GpaData };
    let gpaData = win.gpaDataCache;
    if (!gpaData) {
      try {
        const res = await fetch(`${process.env.PUBLIC_URL}/gpa.json`);
        if (!res.ok) return null;
        gpaData = (await res.json()) as GpaData;
        win.gpaDataCache = gpaData;
      } catch {
        return null;
      }
    }

    const entries = gpaData[courseKey];
    if (!Array.isArray(entries) || entries.length === 0) {
      return {};
    }

    const normalizeToken = (value: string): string =>
      value.toLowerCase().replace(/[^a-z]/g, '');

    const normalizeName = (name: string): { last: string; first: string } => {
      const trimmed = name.trim();
      if (trimmed.includes(',')) {
        const [lastRaw = '', firstRaw = ''] = trimmed.split(',', 2);
        const firstToken = firstRaw.trim().split(/\s+/)[0] ?? '';
        return {
          last: normalizeToken(lastRaw),
          first: normalizeToken(firstToken),
        };
      }

      const parts = trimmed.split(/\s+/);
      const firstToken = parts[0] ?? '';
      const lastToken = parts[parts.length - 1] ?? '';
      return {
        last: normalizeToken(lastToken),
        first: normalizeToken(firstToken),
      };
    };

    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      norm: normalizeName(`${entry.last}, ${entry.first}`),
    }));

    const gpaMap: CourseGpa = {};

    const validGpas = normalizedEntries
      .map((entry) => entry.gpa)
      .filter((gpa) => typeof gpa === 'number' && !Number.isNaN(gpa));
    if (validGpas.length > 0) {
      gpaMap.averageGpa =
        validGpas.reduce((sum, gpa) => sum + gpa, 0) / validGpas.length;
    }

    const instructorNames = new Set(
      this.sections.flatMap((section) => section.instructors)
    );

    instructorNames.forEach((instructorName) => {
      const norm = normalizeName(instructorName);
      let matches = normalizedEntries.filter(
        (entry) =>
          entry.norm.last === norm.last && entry.norm.first === norm.first
      );

      if (matches.length === 0 && norm.first.length > 0) {
        const firstInitial = norm.first[0];
        if (!firstInitial) {
          return;
        }
        matches = normalizedEntries.filter(
          (entry) =>
            entry.norm.last === norm.last &&
            entry.norm.first.startsWith(firstInitial)
        );
      }

      if (matches.length > 0) {
        const avg =
          matches.reduce((sum, entry) => sum + entry.gpa, 0) / matches.length;
        gpaMap[instructorName] = avg;
      }
    });

    return gpaMap;
  }

}
