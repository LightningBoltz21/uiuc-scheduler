import { scrapeCourse, scrapeSubjects, scrapeCourseList, CourseInfo } from './scraper';
import { DataWriter } from './writer';
import { getIntConfig, discoverLatestTerms, getTermCode, getTermName } from './utils';
import asyncPool from 'tiny-async-pool';
import { backOff } from 'exponential-backoff';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Progress file helpers for resume functionality
 */
function getProgressFilePath(termCode: string, outputDir: string): string {
  return path.join(outputDir, `progress-${termCode}.txt`);
}

function loadProgress(termCode: string, outputDir: string): Set<string> {
  const progressFile = getProgressFilePath(termCode, outputDir);
  const scraped = new Set<string>();
  
  if (fs.existsSync(progressFile)) {
    const content = fs.readFileSync(progressFile, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed) scraped.add(trimmed);
    });
  }
  
  return scraped;
}

function appendProgress(termCode: string, outputDir: string, courseKey: string): void {
  const progressFile = getProgressFilePath(termCode, outputDir);
  fs.appendFileSync(progressFile, courseKey + '\n', 'utf-8');
}

function clearProgress(termCode: string, outputDir: string): void {
  const progressFile = getProgressFilePath(termCode, outputDir);
  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }
}

/**
 * Load existing term data JSON to merge with new scrapes
 */
function loadExistingTermData(termCode: string, outputDir: string): { courses: Record<string, any> } | null {
  const jsonFile = path.join(outputDir, `${termCode}.json`);
  
  if (fs.existsSync(jsonFile)) {
    try {
      const content = fs.readFileSync(jsonFile, 'utf-8');
      const data = JSON.parse(content);
      return { courses: data.courses || {} };
    } catch (error) {
      console.warn(`  ⚠️  Could not load existing ${termCode}.json, starting fresh`);
      return null;
    }
  }
  
  return null;
}

/**
 * Configuration from environment variables
 */
const SPECIFIED_TERMS = process.env.SPECIFIED_TERMS?.split(',').map(termStr => {
  const [year, term] = termStr.trim().split('/');
  return { year, term };
});

const CONCURRENCY = getIntConfig('CONCURRENCY') ?? 2;
const REQUEST_DELAY_MS = getIntConfig('REQUEST_DELAY_MS') ?? 500;
const COURSES_PER_SUBJECT = getIntConfig('COURSES_PER_SUBJECT') ?? null; // null = all courses
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
const MAX_403_ERRORS = 1; // Abort on first 403 and save progress
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
            console.error(`\n❌ 403 Forbidden on ${course.subject} ${course.number}`);
            console.error(`🛑 ABORTING: UIUC server blocked request`);
            console.error(`   Saving progress and stopping scraper...\n`);
            abortRequested = true;
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
  console.log(`  - CONCURRENCY: ${CONCURRENCY}`);
  console.log(`  - REQUEST_DELAY_MS: ${REQUEST_DELAY_MS}`);
  if (COURSES_PER_SUBJECT !== null) {
    console.log(`  - COURSES_PER_SUBJECT: ${COURSES_PER_SUBJECT} (testing mode)`);
  } else {
    console.log(`  - COURSE_LIMIT: NONE (full scrape)`);
  }
  console.log(`  - OUTPUT_DIR: ${OUTPUT_DIR}\n`);
  
  // Determine which terms to scrape
  const termsToScrape = SPECIFIED_TERMS || await discoverLatestTerms(2);
  
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
        
        if (COURSES_PER_SUBJECT !== null && courses.length > 0) {
          // Take first N courses from this subject
          const coursesToTake = courses.slice(0, COURSES_PER_SUBJECT);
          allCourses.push(...coursesToTake);
          console.log(`    ✓ Found ${courses.length} courses in ${subject}, taking first ${coursesToTake.length}`);
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
      
      console.log(`\n  📚 Total courses discovered: ${allCourses.length}`);
      if (COURSES_PER_SUBJECT !== null) {
        console.log(`  ⚠️  COURSES_PER_SUBJECT mode: Testing with ${COURSES_PER_SUBJECT} courses per subject`);
      }

      if (allCourses.length === 0) {
        console.log(`  ⚠️  No courses found for ${term} ${year}, skipping...`);
        continue;
      }

      // Load progress to resume from where we left off
      const termCode = getTermCode(year, term);
      const alreadyScraped = loadProgress(termCode, OUTPUT_DIR);
      
      if (alreadyScraped.size > 0) {
        console.log(`\n  📂 Found existing progress: ${alreadyScraped.size} courses already scraped`);
      }
      
      // Filter out already-scraped courses
      const coursesToScrape = allCourses.filter(course => {
        const courseKey = `${course.subject} ${course.number}`;
        return !alreadyScraped.has(courseKey);
      });
      
      if (coursesToScrape.length === 0) {
        console.log(`  ✅ All ${allCourses.length} courses already scraped! Skipping term.`);
        continue;
      }
      
      console.log(`  📝 Remaining to scrape: ${coursesToScrape.length} courses\n`);

      // Step 3: Scrape remaining courses in parallel
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
      const results = await asyncPool(CONCURRENCY, coursesToScrape, async (course: CourseInfo) => {
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
          
          // Append to progress file immediately so we don't lose progress
          appendProgress(termCode, OUTPUT_DIR, courseKey);
        } else {
          failureCount++;
        }

        // Log progress every 10 courses in test mode, 50 in full mode
        const progressInterval = COURSES_PER_SUBJECT !== null ? 10 : 50;
        if (completed % progressInterval === 0 || completed === coursesToScrape.length) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
          const eta = coursesToScrape.length > completed 
            ? ((coursesToScrape.length - completed) / parseFloat(rate)).toFixed(0)
            : '0';
          console.log(`  Progress: ${completed}/${coursesToScrape.length} (${rate}/s, ETA: ${eta}s, Rate limits: ${rateLimitCount})`);
        }
        
        // Check if we should abort
        if (abortRequested) {
          break;
        }
      }
      
      // Handle abort scenario
      if (abortRequested) {
        console.error(`\n❌ Scraping aborted due to 403 Forbidden error`);
        console.error(`   Successfully scraped this run: ${successCount} courses`);
        console.error(`   Failed/Skipped: ${failureCount} courses\n`);
        
        // Write partial data if any was collected
        if (successCount > 0) {
          console.log('💾 Step 4: Merging and writing data before exit...');
          
          // Load existing data and merge
          const existingData = loadExistingTermData(termCode, OUTPUT_DIR);
          const mergedCourses = existingData ? { ...existingData.courses, ...coursesMap } : coursesMap;
          
          // Regenerate term data with merged courses
          const mergedWriter = new DataWriter();
          for (const [key, course] of Object.entries(mergedCourses)) {
            // Re-add to writer to rebuild caches (simplified - just use coursesMap for new)
          }
          
          // For now, just merge the courses objects directly
          const termData = writer.generateTermData(coursesMap);
          // Manually merge courses
          termData.courses = mergedCourses;
          
          const termName = getTermName(year, term);
          
          const totalCourses = Object.keys(mergedCourses).length;
          const previousCourses = existingData ? Object.keys(existingData.courses).length : 0;
          
          console.log(`  ✓ Previously scraped: ${previousCourses} courses`);
          console.log(`  ✓ New this run: ${successCount} courses`);
          console.log(`  ✓ Total courses: ${totalCourses}`);
          
          writer.writeTermData(termData, termCode, OUTPUT_DIR);
          allTermData.push({ termCode, termName, data: termData });
          
          console.log(`\n✅ Data saved! Run scraper again to continue where you left off.\n`);
        } else {
          console.error(`   No courses scraped, no data written.\n`);
        }
        
        // Exit with error code so GitHub Actions knows it failed
        process.exit(1);
      }

      // Step 4: Generate and write output (merge with existing)
      console.log('\n📦 Step 4: Merging and building term data...');
      
      // Load existing data and merge
      const existingData = loadExistingTermData(termCode, OUTPUT_DIR);
      const mergedCourses = existingData ? { ...existingData.courses, ...coursesMap } : coursesMap;
      
      const termData = writer.generateTermData(coursesMap);
      termData.courses = mergedCourses; // Use merged courses
      
      const termName = getTermName(year, term);
      
      const totalCourses = Object.keys(mergedCourses).length;
      const previousCourses = existingData ? Object.keys(existingData.courses).length : 0;
      
      if (previousCourses > 0) {
        console.log(`  ✓ Previously scraped: ${previousCourses} courses`);
        console.log(`  ✓ New this run: ${successCount} courses`);
      }
      console.log(`  ✓ Total courses: ${totalCourses}`);
      console.log(`  ✓ Success: ${successCount}, Failed: ${failureCount}`);
      console.log(`  ✓ Cached periods: ${termData.caches.periods.length}`);
      console.log(`  ✓ Cached locations: ${termData.caches.locations.length}`);
      console.log(`  ✓ Cached scheduleTypes: ${termData.caches.scheduleTypes.length}`);

      // Write term data JSON
      console.log('\n💾 Writing output file...');
      writer.writeTermData(termData, termCode, OUTPUT_DIR);

      allTermData.push({ termCode, termName, data: termData });
      
      // Clear progress file since term is complete
      if (coursesToScrape.length === allCourses.length - alreadyScraped.size) {
        clearProgress(termCode, OUTPUT_DIR);
        console.log('  ✓ Progress file cleared (term complete)');
      }

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
