import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedCourse, ScrapedSection, ScrapedMeeting } from './types';

const UIUC_BASE_URL = 'https://courses.illinois.edu';

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
  courseNumber: string
): Promise<ScrapedCourse> {
  const url = `${UIUC_BASE_URL}/schedule/${year}/${term}/${subject}/${courseNumber}`;
  console.log(`Fetching: ${url}`);

  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    // Extract course title from h1
    const courseTitle = $('h1.app-inline').first().text().trim() || `${subject} ${courseNumber}`;
    
    // Extract course description
    const description = $('#app-course-info p').filter((i, el) => {
      const text = $(el).text();
      return text.length > 50 && !text.includes('Credit:');
    }).first().text().trim() || null;

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
      // Parse HTML-encoded fields
      const $type = cheerio.load(sectionObj.type);
      const scheduleType = $type('.app-meeting').text().trim() || 'Lecture';

      const $section = cheerio.load(sectionObj.section);
      const sectionId = $section('.app-meeting').text().trim();

      const $time = cheerio.load(sectionObj.time);
      const timeText = $time('.app-meeting').text().trim();

      const $day = cheerio.load(sectionObj.day);
      const days = $day('.app-meeting').text().trim();

      const $location = cheerio.load(sectionObj.location);
      const location = $location('.app-meeting').text().trim() || 'TBA';

      const $instructor = cheerio.load(sectionObj.instructor);
      const instructorText = $instructor('.app-meeting').html() || '';
      const instructors = instructorText
        .split('<br>')
        .map(i => cheerio.load(i).text().trim())
        .filter(i => i && i !== 'TBA');

      // Parse time
      const { startTime, endTime } = parseTime(timeText);

      // Extract building from location
      const building = extractBuilding(location);

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

      // Create meeting
      const meeting: ScrapedMeeting = {
        days,
        startTime,
        endTime,
        room: location,
        building,
        instructors: instructors.length > 0 ? instructors : ['Staff'],
        dateRange
      };

      sections.push({
        crn: sectionObj.crn,
        sectionId,
        sectionTitle,
        scheduleType,
        campus: 'Urbana-Champaign',
        attributes: [],
        gradeBase: 'Letter Grade',
        meetings: [meeting],
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

function extractScheduleType(sectionId: string): string {
  if (/^[A-Z]+L\d*$/i.test(sectionId)) return 'Lab';
  if (/^[A-Z]+D\d*$/i.test(sectionId)) return 'Discussion';
  if (/online/i.test(sectionId)) return 'Online Lecture';
  return 'Lecture';
}

function extractDays(text: string): string {
  const daysMatch = text.match(/\b([MTWRFSU]+)\b/);
  return daysMatch ? daysMatch[1] : '';
}

function parseTime(timeText: string): { startTime: string; endTime: string } {
  // Match patterns like "8:00 AM - 8:50 AM" or "08:00-08:50"
  const match = timeText.match(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  
  if (match) {
    const start = match[1];
    const startPeriod = match[2] || 'AM';
    const end = match[3];
    const endPeriod = match[4] || match[2] || 'PM';
    
    return {
      startTime: `${start} ${startPeriod}`,
      endTime: `${end} ${endPeriod}`
    };
  }
  
  return { startTime: 'TBA', endTime: 'TBA' };
}

function extractBuilding(room: string): string {
  // Extract building name from room string like "Siebel Center 1404"
  const match = room.match(/^(.+?)\s+\d+/);
  return match ? match[1] : room;
}

function getTermStartDate(year: string, term: string): string {
  const dates: Record<string, string> = {
    spring: `Jan 15, ${year}`,
    summer: `Jun 1, ${year}`,
    fall: `Aug 21, ${year}`,
    winter: `Jan 3, ${year}`
  };
  return dates[term.toLowerCase()] || `${term} ${year}`;
}

function getTermEndDate(year: string, term: string): string {
  const dates: Record<string, string> = {
    spring: `May 10, ${year}`,
    summer: `Aug 5, ${year}`,
    fall: `Dec 10, ${year}`,
    winter: `Jan 20, ${year}`
  };
  return dates[term.toLowerCase()] || `${term} ${year}`;
}
