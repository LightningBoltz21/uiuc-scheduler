import { scrapeCourse, scrapeSubjects, scrapeCourseList, CourseInfo } from './scraper';
import { DataWriter } from './writer';
import { getIntConfig, discoverLatestTerms, getTermCode, getTermName } from './utils';
import asyncPool from 'tiny-async-pool';
import { backOff } from 'exponential-backoff';
import * as path from 'path';

/**
 * Configuration from environment variables
 */
const SPECIFIED_TERMS = process.env.SPECIFIED_TERMS?.split(',').map(termStr => {
  const [year, term] = termStr.trim().split('/');
  return { year, term };
});

const NUM_TERMS = SPECIFIED_TERMS
  ? SPECIFIED_TERMS.length
  : getIntConfig('NUM_TERMS') ?? 2;

const CONCURRENCY = getIntConfig('CONCURRENCY') ?? 2;
const REQUEST_DELAY_MS = getIntConfig('REQUEST_DELAY_MS') ?? 500;
const ONE_COURSE_PER_SUBJECT = getIntConfig('ONE_COURSE_PER_SUBJECT') === 1;
const OUTPUT_DIR = path.join(__dirname, '..', 'data');

/**
 * Sleep for specified milliseconds with optional jitter to appear more human
 * @param ms - Base milliseconds to sleep
 * @param jitterPercent - Percentage of jitter (0-1), default 0.3 = ±30%
 */
function sleep(ms: number, jitterPercent: number = 0.3): Promise<void> {
  // Add random jitter to make requests less predictable
  const jitter = ms * jitterPercent * (Math.random() * 2 - 1);
  const actualDelay = Math.max(100, ms + jitter); // Minimum 100ms
  return new Promise(resolve => setTimeout(resolve, actualDelay));
}

let totalRequests = 0;
let rateLimitCount = 0;
let forbidden403Count = 0;
const MAX_403_ERRORS = 5; // Threshold before aborting
let abortRequested = false;

/**
 * Scrape a single course with retry logic AND rate limiting delay
 */
async function scrapeWithRetry(
  year: string,
  term: string,
  course: CourseInfo,
  delayMs: number = 500
): Promise<{ course: CourseInfo; data: any; success: boolean }> {
  // Check if abort was requested
  if (abortRequested) {
    return { course, data: null, success: false };
  }

  // Add delay before EACH request for rate limiting (with jitter)
  await sleep(delayMs);
  totalRequests++;
  
  try {
    const scraped = await backOff(
      () => scrapeCourse(year, term, course.subject, course.number),
      {
        jitter: 'full',
        numOfAttempts: 3, // Reduced retries
        startingDelay: 2000, // Start with 2 second delay on retries
        retry: (err: any, attemptNumber: number) => {
          // Check for 403 Forbidden errors
          if (err.response?.status === 403) {
            forbidden403Count++;
            console.error(`\n❌ 403 Forbidden on ${course.subject} ${course.number} (${forbidden403Count}/${MAX_403_ERRORS})`);
            
            if (forbidden403Count >= MAX_403_ERRORS) {
              console.error(`\n🛑 ABORTING: Too many 403 Forbidden errors`);
              console.error(`   UIUC server is blocking requests. Possible causes:`);
              console.error(`   - Rate limiting / bot detection`);
              console.error(`   - IP address blocked`);
              console.error(`   - Request headers flagged\n`);
              abortRequested = true;
              return false; // Don't retry
            }
            return false; // Don't retry 403s
          }
          
          if (err.response?.status === 429) {
            rateLimitCount++;
            console.log(`  ⚠️  Rate limited on ${course.subject} ${course.number} (attempt ${attemptNumber})`);
            
            if (rateLimitCount > 5) {
              console.warn(`\n⚠️⚠️⚠️  EXCESSIVE RATE LIMITING! (${rateLimitCount} times)`);
              console.warn(`Consider stopping and reducing CONCURRENCY or increasing REQUEST_DELAY_MS\n`);
            }
          }
          return err.code === 'ECONNRESET' || 
                 err.response?.status === 429 || 
                 err.response?.status >= 500;
        }
      }
    );
    return { course, data: scraped, success: true };
  } catch (error: any) {
    // Don't spam errors if we're aborting
    if (!abortRequested) {
      console.error(`  ❌ Failed to scrape ${course.subject} ${course.number}:`, error.message);
    }
    return { course, data: null, success: false };
  }
}

/**
 * Main entry point for UIUC Crawler v3
 */
async function main() {
  console.log('🚀 UIUC Crawler v3 - Bulk Scraping Mode\n');
  console.log(`Configuration:`);
  console.log(`  - NUM_TERMS: ${NUM_TERMS}`);
  console.log(`  - CONCURRENCY: ${CONCURRENCY}`);
  console.log(`  - REQUEST_DELAY_MS: ${REQUEST_DELAY_MS}`);
  console.log(`  - ONE_COURSE_PER_SUBJECT: ${ONE_COURSE_PER_SUBJECT ? 'YES (testing mode)' : 'NO (full scrape)'}`);
  console.log(`  - OUTPUT_DIR: ${OUTPUT_DIR}\n`);
  
  // Determine which terms to scrape
  const termsToScrape = SPECIFIED_TERMS || await discoverLatestTerms(NUM_TERMS);
  
  if (termsToScrape.length === 0) {
    console.error('❌ No terms to scrape');
    return;
  }

  console.log(`📅 Terms to scrape:`);
  termsToScrape.forEach(({ year, term }) => {
    console.log(`  - ${getTermName(year, term)} (${year}/${term})`);
  });
  console.log();

  const allTermData: Array<{ termCode: string; termName: string; data: any }> = [];

  for (const { year, term } of termsToScrape) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📅 Processing ${getTermName(year, term).toUpperCase()}...`);
    console.log('='.repeat(60) + '\n');
    
    try {
      // Step 1: Get all subjects
      console.log('🔍 Step 1: Discovering subjects...');
      const subjects = await scrapeSubjects(year, term);
      
      if (subjects.length === 0) {
        console.log(`  ⚠️  No subjects found for ${term} ${year}, skipping...`);
        continue;
      }

      // Step 2: Get all courses for each subject
      console.log('\n🔍 Step 2: Discovering courses...');
      const allCourses: CourseInfo[] = [];
      let subjectIndex = 0;
      const totalSubjects = subjects.length;
      
      for (const subject of subjects) {
        subjectIndex++;
        const courses = await scrapeCourseList(year, term, subject);
        
        if (ONE_COURSE_PER_SUBJECT && courses.length > 0) {
          // Only take the first course from this subject
          allCourses.push(courses[0]);
          console.log(`    ✓ Found ${courses.length} courses in ${subject}, taking first: ${courses[0].subject} ${courses[0].number}`);
        } else {
          allCourses.push(...courses);
          console.log(`    ✓ Found ${courses.length} courses in ${subject}`);
        }
        
        // Show progress every 20 subjects
        if (subjectIndex % 20 === 0 || subjectIndex === totalSubjects) {
          console.log(`  📊 Progress: ${subjectIndex}/${totalSubjects} subjects (${allCourses.length} courses found)`);
        }
        
        // Conservative delay between subjects (with jitter)
        await sleep(1000, 0.3);
      }
      
      console.log(`\n  📚 Total courses to scrape: ${allCourses.length}`);
      if (ONE_COURSE_PER_SUBJECT) {
        console.log(`  ⚠️  ONE_COURSE_PER_SUBJECT mode: Testing with 1 course per subject\n`);
      } else {
        console.log();
      }

      if (allCourses.length === 0) {
        console.log(`  ⚠️  No courses found for ${term} ${year}, skipping...`);
        continue;
      }

      // Step 3: Scrape all courses in parallel
      console.log('🔍 Step 3: Scraping courses in parallel...');
      const writer = new DataWriter();
      const coursesMap: Record<string, any> = {};
      let successCount = 0;
      let failureCount = 0;

      // Progress tracking
      let completed = 0;
      const startTime = Date.now();

      // Reset abort flag for each term
      abortRequested = false;
      forbidden403Count = 0;
      
      // Collect all results from parallel scraping
      const results = await asyncPool(CONCURRENCY, allCourses, async (course: CourseInfo) => {
        // Skip if abort requested
        if (abortRequested) {
          return { course, data: null, success: false };
        }
        return await scrapeWithRetry(year, term, course, REQUEST_DELAY_MS);
      });

      // Process all results (asyncPool returns AsyncIterableIterator)
      for await (const result of results) {
        completed++;
        
        if (result.success && result.data) {
          const convertedCourse = writer.convertCourse(result.data);
          const courseKey = `${result.course.subject} ${result.course.number}`;
          coursesMap[courseKey] = convertedCourse;
          successCount++;
        } else {
          failureCount++;
        }

        // Log progress every 10 courses in test mode, 50 in full mode
        const progressInterval = ONE_COURSE_PER_SUBJECT ? 10 : 50;
        if (completed % progressInterval === 0 || completed === allCourses.length) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
          const eta = allCourses.length > completed 
            ? ((allCourses.length - completed) / parseFloat(rate)).toFixed(0)
            : '0';
          console.log(`  Progress: ${completed}/${allCourses.length} (${rate}/s, ETA: ${eta}s, Rate limits: ${rateLimitCount})`);
        }
        
        // Check if we should abort
        if (abortRequested) {
          break;
        }
      }
      
      // Handle abort scenario
      if (abortRequested) {
        console.error(`\n❌ Scraping aborted due to 403 Forbidden errors`);
        console.error(`   Successfully scraped: ${successCount} courses`);
        console.error(`   Failed/Skipped: ${failureCount} courses`);
        console.error(`   No data written.\n`);
        
        // Exit with error code
        process.exit(1);

      // Step 4: Generate and write output
      console.log('\n📦 Step 4: Building term data...');
      const termData = writer.generateTermData(coursesMap);
      const termCode = getTermCode(year, term);
      const termName = getTermName(year, term);
      
      console.log(`  ✓ Courses scraped: ${Object.keys(coursesMap).length}`);
      console.log(`  ✓ Success: ${successCount}, Failed: ${failureCount}`);
      console.log(`  ✓ Cached periods: ${termData.caches.periods.length}`);
      console.log(`  ✓ Cached locations: ${termData.caches.locations.length}`);
      console.log(`  ✓ Cached scheduleTypes: ${termData.caches.scheduleTypes.length}`);

      // Write term data JSON
      console.log('\n💾 Writing output file...');
      writer.writeTermData(termData, termCode, OUTPUT_DIR);

      allTermData.push({ termCode, termName, data: termData });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✨ ${getTermName(year, term)} complete in ${totalTime}s!`);

    } catch (error: any) {
      console.error(`\n❌ Failed to process ${term} ${year}:`, error.message);
      console.error(error);
    }
  }

  // Write index.json with all terms
  if (allTermData.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('📝 Writing index.json with all terms...');
    const writer = new DataWriter();
    const terms = allTermData.map(t => ({
      term: t.termCode,
      name: t.termName
    }));
    writer.writeIndex(terms, OUTPUT_DIR);
    console.log('='.repeat(60));
  }

  console.log('\n✨ All crawling complete!\n');
  console.log(`📂 Output directory: ${OUTPUT_DIR}`);
  console.log(`📄 Files created:`);
  allTermData.forEach(t => {
    console.log(`   - ${t.termCode}.json (${t.termName})`);
  });
  console.log(`   - index.json`);
}

// Run the crawler
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
