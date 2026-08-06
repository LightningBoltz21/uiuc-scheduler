import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedCourse, ScrapedSection, ScrapedMeeting } from './types';

const UIUC_BASE_URL = 'https://courses.illinois.edu';

/** Table holding one row per section on a course page */
const SECTION_TABLE_SELECTOR = '#schedule-course-table';

/** Block holding the course title, description and credit hours */
const COURSE_DETAIL_SELECTOR = '#schedule-course-detail';

/**
 * Standard headers for HTTP requests
 */
function getHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
  };
}

/**
 * Interface for a course listing
 */
export interface CourseInfo {
  subject: string;
  number: string;
}

/**
 * Scrapes all subject codes for a given term
 * @param year - Year (e.g., "2026")
 * @param term - Term (e.g., "spring", "winter")
 * @returns Array of subject codes
 */
export async function scrapeSubjects(
  year: string,
  term: string
): Promise<string[]> {
  const url = `${UIUC_BASE_URL}/schedule/${year}/${term}`;
  console.log(`Fetching subjects from: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: getHeaders()
    });
    const html = response.data;
    const $ = cheerio.load(html);

    const subjects: string[] = [];
    
    // Find all subject links in the table
    $('table tbody tr td a').each((i, element) => {
      const href = $(element).attr('href');
      if (href) {
        // Extract subject code from href like "/schedule/2026/spring/CS"
        const match = href.match(/\/schedule\/\d{4}\/\w+\/([A-Z]+)/);
        if (match && match[1]) {
          subjects.push(match[1]);
        }
      }
    });

    console.log(`  ✓ Found ${subjects.length} subjects`);
    return subjects;
  } catch (error) {
    console.error(`Error scraping subjects for ${term} ${year}:`, error);
    throw error;
  }
}

/**
 * Scrapes all courses for a given subject and term
 * @param year - Year (e.g., "2026")
 * @param term - Term (e.g., "spring", "winter")
 * @param subject - Subject code (e.g., "CS", "MATH")
 * @returns Array of course info objects
 */
export async function scrapeCourseList(
  year: string,
  term: string,
  subject: string
): Promise<CourseInfo[]> {
  const url = `${UIUC_BASE_URL}/schedule/${year}/${term}/${subject}`;

  try {
    const response = await axios.get(url, {
      headers: getHeaders()
    });
    const html = response.data;
    const $ = cheerio.load(html);

    const courses: CourseInfo[] = [];
    
    // Find all course links in the table
    $('table tbody tr td a').each((i, element) => {
      const href = $(element).attr('href');
      if (href) {
        // Extract course number from href like "/schedule/2026/spring/CS/101"
        const match = href.match(/\/schedule\/\d{4}\/\w+\/([A-Z]+)\/(\d+[A-Z]*)/);
        if (match && match[1] && match[2]) {
          courses.push({
            subject: match[1],
            number: match[2]
          });
        }
      }
    });

    return courses;
  } catch (error) {
    console.error(`Error scraping courses for ${subject}:`, error);
    return []; // Return empty array on error, don't fail entire scrape
  }
}

/**
 * Scrapes a single course page from UIUC Course Explorer
 * @param year - Year (e.g., "2025")
 * @param term - Term (e.g., "fall", "spring")
 * @param subject - Subject code (e.g., "CS", "MATH")
 * @param courseNumber - Course number (e.g., "100", "225")
 * @returns Scraped course data
 */
export async function scrapeCourse(
  year: string,
  term: string,
  subject: string,
  courseNumber: string,
  signal?: AbortSignal
): Promise<ScrapedCourse> {
  const url = `${UIUC_BASE_URL}/schedule/${year}/${term}/${subject}/${courseNumber}`;
  console.log(`Fetching: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: getHeaders(),
      signal
    });
    const html = response.data;
    const $ = cheerio.load(html);

    // Extract the course title.
    // The page has several `.app-text-engage` elements; the first is the term
    // label ("Fall 2026 All Classes"), so select the one that is also an
    // `.app-label` rather than just taking the first match.
    let courseTitle = $('.app-text-engage.app-label').first().text().trim();
    if (!courseTitle) {
      // Fallback to subject + number
      courseTitle = `${subject} ${courseNumber}`;
    }

    // Extract course description
    let description: string | null = null;
    $(`${COURSE_DETAIL_SELECTOR} p`).each((i, el) => {
      const text = $(el).text().trim();

      // Skip short text, credit info, and GenEd boilerplate
      if (text.length < 30) return true; // continue to next
      if (text.includes('Credit:')) return true;
      if (text.startsWith('This course satisfies')) return true;
      if (text.includes('General Education Criteria')) return true;
      // Skip the "same as"/prerequisite/registration boilerplate
      if (/^(Credit is not given|Prerequisite:|Students must register)/.test(text)) return true;

      // Skip text that's mostly whitespace/formatting artifacts
      const cleanText = text.replace(/\s+/g, ' ').trim();
      if (cleanText.length < 30) return true;

      // Found a real description
      if (!description) {
        description = cleanText;
      }
    });

    // Extract credit hours
    let creditHours = 3; // Default
    const creditText = $(`${COURSE_DETAIL_SELECTOR} p:contains("Credit:")`).first().text();
    const creditMatch = creditText.match(/(\d+(?:\.\d+)?)\s*hours?/i);
    if (creditMatch) {
      creditHours = parseFloat(creditMatch[1]);
    }

    // Sections are rendered server-side into #schedule-course-table.
    // (Course Explorer previously embedded them as a `var sectionDataObj = [...]`
    // JavaScript array; that variable no longer exists.)
    const table = $(SECTION_TABLE_SELECTOR);
    const rows = table.find('tbody tr');

    if (rows.length === 0) {
      // A course with no scheduled sections this term is normal and not an error.
      return {
        subject,
        number: courseNumber,
        title: courseTitle,
        description,
        creditHours,
        sections: []
      };
    }

    // Map column headers to indices so that a column being added or reordered
    // upstream doesn't silently shift every field.
    const columns = buildColumnMap($, table);
    const required = ['crn', 'type', 'section', 'time', 'day', 'location'];
    const missing = required.filter(name => columns[name] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Section table for ${subject} ${courseNumber} is missing expected ` +
        `column(s): ${missing.join(', ')}. Found: ${Object.keys(columns).join(', ')}`
      );
    }

    const sections: ScrapedSection[] = [];

    rows.each((_, row) => {
      const cells = $(row).find('td');
      // Read every `.app-meeting` in a cell, so sections with more than one
      // meeting pattern produce one value per meeting.
      const meetingValues = (name: string): string[] => {
        const index = columns[name];
        if (index === undefined) return [];
        const cell = $(cells[index]);
        const values = cell
          .find('.app-meeting')
          .map((_i, el) => $(el).text().replace(/\s+/g, ' ').trim())
          .get();
        if (values.length > 0) return values;
        const text = cell.text().replace(/\s+/g, ' ').trim();
        return text ? [text] : [];
      };

      const crn = $(cells[columns['crn'] as number]).text().trim();
      if (!crn) return;

      const scheduleTypes = meetingValues('type').map(stripMeetingDates);
      if (scheduleTypes.length === 0) scheduleTypes.push('Lecture');

      const sectionIds = meetingValues('section');
      const timeTexts = meetingValues('time');
      const daysArray = meetingValues('day').map(d => (isPlaceholderDay(d) ? '' : d));
      const locations = meetingValues('location');

      // Instructors are shared across all meetings of a section
      const instructorIndex = columns['instructor'];
      const instructorCell =
        instructorIndex === undefined ? null : $(cells[instructorIndex]);
      const instructors = (instructorCell?.html() ?? '')
        .split(/<br\s*\/?>/i)
        .map(fragment => cheerio.load(fragment).text().replace(/\s+/g, ' ').trim())
        .filter(name => name && name !== 'TBA');

      // Details are in a nested definition list in the "Section Details" cell
      const details = parseSectionDetails($, cells, columns);

      // Use the first section ID / schedule type as the canonical one.
      // Sections without an ID (independent study, for example) fall back to
      // the CRN so that they don't all collide under the same empty key.
      const sectionId = sectionIds[0] || crn;
      const scheduleType = scheduleTypes[0] as string;

      const dateRange = details['date range']
        ? normalizeDateRange(details['date range'] as string, year)
        : `${getTermStartDate(year, term)} - ${getTermEndDate(year, term)}`;

      const restrictions: string[] = [];
      for (const [label, value] of Object.entries(details)) {
        if (label.includes('restriction') && value) restrictions.push(value);
      }

      // Availability comes from the details list, falling back to the
      // status icon's aria-label ("Section Open", "Section Open (Restricted)").
      const statusIndex = columns['status'];
      const statusLabel =
        statusIndex === undefined
          ? ''
          : $(cells[statusIndex]).find('[aria-label]').attr('aria-label') ?? '';
      const availabilityText = (details['availability'] || statusLabel).toLowerCase();

      let enrollmentStatus = 'Open';
      if (availabilityText.includes('closed')) {
        enrollmentStatus = 'Closed';
      } else if (availabilityText.includes('restricted')) {
        enrollmentStatus = 'Restricted';
      }

      // Course Explorer does not publish numeric seat counts
      const seatsAvailable = 0;

      // Create meetings array - one for each meeting time
      const numMeetings = Math.max(
        timeTexts.length,
        daysArray.length,
        locations.length,
        1
      );
      const meetings: ScrapedMeeting[] = [];

      for (let i = 0; i < numMeetings; i++) {
        const timeText = timeTexts[i] ?? timeTexts[0] ?? '';
        const days = daysArray[i] ?? daysArray[0] ?? '';
        const rawLocation = locations[i] ?? locations[0] ?? '';
        const type = scheduleTypes[i] ?? scheduleType;

        const isOnline = type.toLowerCase().includes('online');
        // "Location Pending"/"n.a." mean the room is unassigned, not that the
        // section is online, so they map to TBA rather than ONLINE.
        const hasNoRoom = isPlaceholderLocation(rawLocation);
        let location: string;
        if (isOnline) {
          location = 'ONLINE';
        } else if (hasNoRoom) {
          location = 'TBA';
        } else {
          location = rawLocation;
        }

        // Parse time
        const { startTime, endTime } = parseTime(timeText);

        meetings.push({
          days,
          startTime,
          endTime,
          room: location,
          instructors: instructors.length > 0 ? instructors : ['Unassigned Instructor'],
          dateRange,
          // `isOnline` tells the writer to skip the building coordinate lookup
          isOnline: isOnline || hasNoRoom
        });
      }

      sections.push({
        crn,
        sectionId,
        sectionTitle: courseTitle,
        scheduleType,
        campus: 'Urbana-Champaign',
        attributes: [],
        restrictions,
        enrollmentStatus,
        seatsAvailable,
        gradeBase: 'Letter Grade',
        meetings
      });
    });

    return {
      subject,
      number: courseNumber,
      title: courseTitle,
      description,
      creditHours,
      sections
    };

  } catch (error) {
    console.error(`Error scraping ${subject} ${courseNumber}:`, error);
    throw error;
  }
}

// ===== Helper Functions =====

/**
 * Build a map of normalized column header text to column index, so that
 * fields are read by name rather than by hardcoded position.
 */
function buildColumnMap(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<any>
): Record<string, number> {
  const columns: Record<string, number> = {};
  table
    .find('thead th')
    .each((index, th) => {
      const $th = $(th);
      // Prefer the visible text; fall back to the aria-label, which is
      // formatted like "CRN: Activate to sort" for sortable columns.
      let label = $th.text().replace(/\s+/g, ' ').trim().toLowerCase();
      if (!label) {
        const aria = $th.attr('aria-label') ?? '';
        label = aria.split(':')[0]?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
      }
      if (label && columns[label] === undefined) {
        columns[label] = index;
      }
    });
  return columns;
}

/**
 * Read the nested definition list in a row's "Section Details" cell into a
 * map of lowercased label (without the trailing colon) to value.
 */
function parseSectionDetails(
  $: cheerio.CheerioAPI,
  cells: cheerio.Cheerio<any>,
  columns: Record<string, number>
): Record<string, string> {
  const details: Record<string, string> = {};
  const index = columns['section details'];
  if (index === undefined) return details;

  const dl = $(cells[index]).find('dl').first();
  let label = '';
  dl.children().each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (el.tagName === 'dt') {
      label = text.replace(/:$/, '').toLowerCase();
    } else if (el.tagName === 'dd' && label) {
      details[label] = text;
      label = '';
    }
  });
  return details;
}

/**
 * Course Explorer sometimes concatenates the schedule type with the meeting
 * dates, like "LaboratoryMeets 03/16/26-05/06/26".
 */
function stripMeetingDates(typeText: string): string {
  const meetsPattern = /Meets\s+\d{2}\/\d{2}\/\d{2}(?:-\d{2}\/\d{2}\/\d{2})?$/;
  const stripped = typeText.replace(meetsPattern, '').trim();
  return stripped || 'Lecture';
}

function isPlaceholderDay(day: string): boolean {
  const normalized = day.trim().toLowerCase();
  return normalized === 'n.a.' || normalized === 'n.a' || normalized === '';
}

function isPlaceholderLocation(location: string): boolean {
  const normalized = location.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'n.a.' ||
    normalized === 'n.a' ||
    normalized === 'tba' ||
    normalized === 'location pending'
  );
}

/**
 * Convert a Course Explorer date range ("08/24/26-12/09/26") into the
 * " - "-separated, 4-digit-year form that the website's `Oscar` bean parses
 * with `new Date(...)`.
 */
function normalizeDateRange(raw: string, year: string): string {
  const match = raw.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/
  );
  if (!match) return raw.trim();

  const century = year.slice(0, 2);
  const expand = (value: string): string =>
    value.length === 4 ? value : `${century}${value.padStart(2, '0')}`;

  const [, m1, d1, y1, m2, d2, y2] = match as unknown as string[];
  return `${m1}/${d1}/${expand(y1)} - ${m2}/${d2}/${expand(y2)}`;
}

function parseTimeToMinutes(timeStr: string): number {
  // Parse "03:00 PM" -> 900 minutes from midnight (15 * 60)
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 0;
  
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3].toUpperCase();
  
  // Convert to 24-hour format
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

function parseTime(timeText: string): { startTime: number; endTime: number } {
  // Check for ARRANGED times - use -1 as marker
  if (timeText === 'ARRANGED') {
    return { startTime: -1, endTime: -1 }; // -1 indicates ARRANGED
  }

  // Check for empty/unknown times - use -2 as marker for TBA
  if (timeText.trim() === '') {
    return { startTime: -2, endTime: -2 }; // -2 indicates TBA
  }

  // Match patterns like "8:00 AM - 8:50 AM" or "08:00-08:50" or "03:00PM - 03:50PM"
  const match = timeText.match(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/i);

  if (match) {
    const start = match[1];
    const startPeriod = (match[2] || 'AM').toUpperCase();
    const end = match[3];
    const endPeriod = (match[4] || match[2] || 'PM').toUpperCase();

    const startTime = parseTimeToMinutes(`${start} ${startPeriod}`);
    const endTime = parseTimeToMinutes(`${end} ${endPeriod}`);

    return { startTime, endTime };
  }

  return { startTime: -2, endTime: -2 }; // -2 indicates TBA for unrecognized formats
}

function getTermStartDate(year: string, term: string): string {
  const dates: Record<string, string> = {
    spring: `01/15/${year}`,
    summer: `06/01/${year}`,
    fall: `08/25/${year}`,
    winter: `01/03/${year}`
  };
  return dates[term.toLowerCase()] || `01/01/${year}`;
}

function getTermEndDate(year: string, term: string): string {
  const dates: Record<string, string> = {
    spring: `05/10/${year}`,
    summer: `08/05/${year}`,
    fall: `12/10/${year}`,
    winter: `01/20/${year}`
  };
  return dates[term.toLowerCase()] || `12/31/${year}`;
}
