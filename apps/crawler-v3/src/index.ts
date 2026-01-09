import { scrapeCourse } from './scraper';
import { DataWriter, getTermCode, getTermName } from './writer';
import * as path from 'path';

/**
 * Main entry point for UIUC Crawler v3
 */
async function main() {
  console.log('🚀 UIUC Crawler v3 Starting...\n');

  // Configuration (hardcoded for MVP)
  const YEAR = '2025';
  const TERM = 'fall';
  const COURSES_TO_SCRAPE = [
    { subject: 'CS', number: '100' }
  ];
  
  const OUTPUT_DIR = path.join(__dirname, '..', 'data');
  
  try {
    // Initialize data writer
    const writer = new DataWriter();
    const coursesMap: Record<string, any> = {};

    // Scrape each course
    for (const course of COURSES_TO_SCRAPE) {
      console.log(`📚 Scraping ${course.subject} ${course.number}...`);
      
      const scrapedCourse = await scrapeCourse(
        YEAR,
        TERM,
        course.subject,
        course.number
      );

      // Convert to tuple format
      const convertedCourse = writer.convertCourse(scrapedCourse);
      const courseKey = `${course.subject} ${course.number}`;
      coursesMap[courseKey] = convertedCourse;

      console.log(`  ✓ Found ${scrapedCourse.sections.length} section(s)`);
    }

    // Generate term data
    console.log('\n📦 Building term data...');
    const termData = writer.generateTermData(coursesMap);
    const termCode = getTermCode(YEAR, TERM);
    
    console.log(`  - Courses: ${Object.keys(coursesMap).length}`);
    console.log(`  - Cached periods: ${termData.caches.periods.length}`);
    console.log(`  - Cached locations: ${termData.caches.locations.length}`);

    // Write term data JSON
    console.log('\n💾 Writing output files...');
    writer.writeTermData(termData, termCode, OUTPUT_DIR);

    // Write index.json
    const terms = [{
      term: termCode,
      name: getTermName(YEAR, TERM)
    }];
    writer.writeIndex(terms, OUTPUT_DIR);

    console.log('\n✨ Crawling complete!\n');
    console.log(`📂 Output directory: ${OUTPUT_DIR}`);
    console.log(`📄 Files created:`);
    console.log(`   - ${termCode}.json`);
    console.log(`   - index.json`);

  } catch (error) {
    console.error('\n❌ Crawling failed:', error);
    process.exit(1);
  }
}

// Run the crawler
main();
