import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedCourse, ScrapedSection, ScrapedMeeting } from './types';

const UIUC_BASE_URL = 'https://courses.illinois.edu';

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

    // Extract course title from the span inside #app-course-info
    // HTML structure: <span class="app-label app-text-engage">Introduction to Advertising</span>
    let courseTitle = $('#app-course-info span.app-text-engage').first().text().trim();
    if (!courseTitle) {
      // Try without the parent selector
      courseTitle = $('span.app-text-engage').first().text().trim();
    }
    if (!courseTitle) {
      // Try the class separately
      courseTitle = $('.app-text-engage').first().text().trim();
    }
    if (!courseTitle) {
      // Fallback to subject + number
      courseTitle = `${subject} ${courseNumber}`;
    }
    
    console.log(`    Title extracted: "${courseTitle}"`);
    
    // Extract course description
    let description: string | null = null;
    $('#app-course-info p').each((i, el) => {
      const text = $(el).text().trim();
      
      // Skip short text, credit info, and GenEd boilerplate
      if (text.length < 30) return true; // continue to next
      if (text.includes('Credit:')) return true;
      if (text.startsWith('This course satisfies')) return true;
      if (text.includes('General Education Criteria')) return true;
      if (text.includes('Winter 2025') || text.includes('Spring 2026') || text.includes('Fall 2025')) return true;
      
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
    const creditText = $('#app-course-info p:contains("Credit:")').text();
    const creditMatch = creditText.match(/(\d+(?:\.\d+)?)\s*hours?/i);
    if (creditMatch) {
      creditHours = parseFloat(creditMatch[1]);
    }

    // Extract sectionDataObj from the embedded JavaScript
    const sectionDataMatch = html.match(/var sectionDataObj = (\[.*?\]);/s);
    
    if (!sectionDataMatch) {
      console.warn(`No section data found for ${subject} ${courseNumber}`);
      return {
        subject,
        number: courseNumber,
        title: courseTitle,
        description,
        creditHours,
        sections: []
      };
    }

    // Parse the JSON data
    const sectionData = JSON.parse(sectionDataMatch[1]);
    const sections: ScrapedSection[] = [];

    for (const sectionObj of sectionData) {
      // Parse HTML-encoded fields - each field may have multiple .app-meeting elements
      const $type = cheerio.load(sectionObj.type);
      const $section = cheerio.load(sectionObj.section);
      const $time = cheerio.load(sectionObj.time);
      const $day = cheerio.load(sectionObj.day);
      const $location = cheerio.load(sectionObj.location);
      const $instructor = cheerio.load(sectionObj.instructor);

      // Get arrays of values for each field (one per meeting)
      const scheduleTypes: string[] = [];
      $type('.app-meeting').each((_, el) => {
        scheduleTypes.push($type(el).text().trim() || 'Lecture');
      });
      if (scheduleTypes.length === 0) scheduleTypes.push('Lecture');

      const sectionIds: string[] = [];
      $section('.app-meeting').each((_, el) => {
        sectionIds.push($section(el).text().trim());
      });
      if (sectionIds.length === 0) sectionIds.push('');

      const timeTexts: string[] = [];
      $time('.app-meeting').each((_, el) => {
        timeTexts.push($time(el).text().trim());
      });
      if (timeTexts.length === 0) timeTexts.push('');

      const daysArray: string[] = [];
      $day('.app-meeting').each((_, el) => {
        let d = $day(el).text().trim();
        if (d === 'n.a.' || d === 'n.a') d = '';
        daysArray.push(d);
      });
      if (daysArray.length === 0) daysArray.push('');

      const locations: string[] = [];
      $location('.app-meeting').each((_, el) => {
        locations.push($location(el).text().trim() || 'TBA');
      });
      if (locations.length === 0) locations.push('TBA');

      // Instructors are shared across all meetings
      const instructorText = $instructor('.app-meeting').html() || '';
      const instructors = instructorText
        .split('<br>')
        .map(i => cheerio.load(i).text().trim())
        .filter(i => i && i !== 'TBA');

      // Use the first section ID as the canonical one
      const sectionId = sectionIds[0];
      // Use the first schedule type as the canonical one
      const scheduleType = scheduleTypes[0];

      // Get date range
      const dateRange = sectionObj.sectionDateRange || 
                       `${getTermStartDate(year, term)} - ${getTermEndDate(year, term)}`;

      // Parse restrictions
      const restrictions: string[] = [];
      if (sectionObj.restricted) {
        const $restricted = cheerio.load(sectionObj.restricted);
        const restrictionText = $restricted.text().trim();
        if (restrictionText) {
          restrictions.push(restrictionText);
        }
      }

      // Get section title
      const sectionTitle = sectionObj.sectionTitle || courseTitle;

      // Create meetings array - one for each meeting time
      const numMeetings = Math.max(timeTexts.length, daysArray.length, locations.length);
      const meetings: ScrapedMeeting[] = [];

      for (let i = 0; i < numMeetings; i++) {
        const timeText = timeTexts[i] || timeTexts[0] || '';
        const days = daysArray[i] || daysArray[0] || '';
        let location = locations[i] || locations[0] || 'TBA';

        // Detect online/arranged classes
        const isOnlineOrArranged = location === 'n.a.' || location === 'n.a' || 
                                    (scheduleTypes[i] || scheduleType).toLowerCase().includes('online') ||
                                    timeText === 'ARRANGED';
        
        if (isOnlineOrArranged) {
          location = 'ONLINE';
        }

        // Parse time
        const { startTime, endTime } = parseTime(timeText);

        // Extract building from location
        const building = isOnlineOrArranged ? 'ONLINE' : extractBuilding(location);

        meetings.push({
          days,
          startTime,
          endTime,
          room: location,
          building,
          instructors: instructors.length > 0 ? instructors : ['Staff'],
          dateRange,
          isOnline: isOnlineOrArranged
        });
      }

      sections.push({
        crn: sectionObj.crn,
        sectionId,
        sectionTitle,
        scheduleType,
        campus: 'Urbana-Champaign',
        attributes: [],
        gradeBase: 'Letter Grade',
        meetings,
        restrictions
      });
    }

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
  
  return { startTime: 0, endTime: 0 };
}

function extractBuilding(room: string): string {
  // Extract building name from room string like "Siebel Center 1404"
  const match = room.match(/^(.+?)\s+\d+/);
  return match ? match[1] : room;
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
