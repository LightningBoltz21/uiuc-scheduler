import { scrapeCourse, scrapeSubjects, scrapeCourseList, CourseInfo } from './scraper';
import { DataWriter } from './writer';
import { getIntConfig, discoverLatestTerms, getTermCode, getTermName } from './utils';
import { 
  ProgressManager, 
  writeIndexTemp, 
  promoteIndexTemp
} from './progress';
import { Course } from './types';
import asyncPool from 'tiny-async-pool';
import * as path from 'path';

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
const SUBJECT_SAVE_INTERVAL = getIntConfig('SUBJECT_SAVE_INTERVAL') ?? 100; // Save every N courses
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

// Global state for rate limiting tracking
let totalRequests = 0;
let abortRequested = false;

/**
 * Scrape a single course with rate limiting delay
 */
async function scrapeWithDelay(
  year: string,
  term: string,
  course: CourseInfo,
  delayMs: number = 500,
  abortController?: AbortController
): Promise<{ course: CourseInfo; data: any; success: boolean; errorType?: string }> {
  // Check if abort was requested
  if (abortRequested) {
    return { course, data: null, success: false, errorType: 'aborted' };
  }

  // Add delay before EACH request for rate limiting (with jitter)
  await sleep(delayMs);
  totalRequests++;
  
  try {
    const scraped = await scrapeCourse(
      year,
      term,
      course.subject,
      course.number,
      abortController?.signal
    );
    return { course, data: scraped, success: true };
  } catch (error: any) {
    // Check for 403 Forbidden errors
    if (error.response?.status === 403) {
      console.error(`\n❌ 403 Forbidden on ${course.subject} ${course.number}`);
      console.error(`🛑 ABORTING: UIUC server blocked request`);
      abortRequested = true;
      // Abort any in-flight requests
      try { abortController?.abort('403 Forbidden - abort all requests'); } catch {}
      return { course, data: null, success: false, errorType: '403' };
    }
    
    if (error.response?.status === 429) {
      console.log(`  ⚠️  Rate limited on ${course.subject} ${course.number}`);
      return { course, data: null, success: false, errorType: '429' };
    }
    
    // Treat canceled requests quietly
    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
      return { course, data: null, success: false, errorType: 'canceled' };
    }

    // Don't spam errors if we're aborting
    if (!abortRequested) {
      console.error(`  ❌ Failed to scrape ${course.subject} ${course.number}:`, error.message);
    }
    return { course, data: null, success: false, errorType: 'error' };
  }
}

/**
 * Scrape all courses for a single subject with write-through caching
 */
async function scrapeSubjectCourses(
  year: string,
  term: string,
  subject: string,
  allCoursesInSubject: CourseInfo[],
  existingCourses: Record<string, Course>,
  progressManager: ProgressManager,
  writer: DataWriter,
  subjectIndex: number,
  totalSubjects: number
): Promise<{ success: boolean; aborted: boolean; courses: Record<string, Course> }> {
  // Determine which courses still need to be scraped
  const existingKeys = new Set(Object.keys(existingCourses));
  const coursesToScrape = allCoursesInSubject.filter(course => {
    const key = `${course.subject} ${course.number}`;
    return !existingKeys.has(key);
  });
  
  const alreadyScraped = existingKeys.size;
  const totalForSubject = allCoursesInSubject.length;
  
  // If all courses already scraped, skip
  if (coursesToScrape.length === 0) {
    console.log(`  ✅ ${subject}: Already complete (${alreadyScraped}/${totalForSubject} courses)`);
    return { success: true, aborted: false, courses: existingCourses };
  }
  
  // Log resume info if resuming
  if (alreadyScraped > 0) {
    console.log(`  📂 ${subject}: Resuming from course #${alreadyScraped + 1} (${alreadyScraped}/${totalForSubject} already scraped)`);
  } else {
    console.log(`  🔍 ${subject}: Scraping ${totalForSubject} courses...`);
  }
  
  // Start with existing courses
  const coursesMap: Record<string, Course> = { ...existingCourses };
  let successThisRun = 0;
  let failedThisRun = 0;
  let lastSaveCount = alreadyScraped;
  
  // Create abort controller for this subject
  const abortController = new AbortController();
  
  // Reset abort flag
  abortRequested = false;
  
  const startTime = Date.now();
  let completed = 0;
  
  // Scrape courses in parallel
  const results = await asyncPool(CONCURRENCY, coursesToScrape, async (course: CourseInfo) => {
    if (abortRequested) {
      return { course, data: null, success: false, errorType: 'aborted' };
    }
    return await scrapeWithDelay(year, term, course, REQUEST_DELAY_MS, abortController);
  });
  
  // Process results
  for await (const result of results) {
    completed++;
    
    if (result.success && result.data) {
      const convertedCourse = writer.convertCourse(result.data);
      const courseKey = `${result.course.subject} ${result.course.number}`;
      coursesMap[courseKey] = convertedCourse;
      successThisRun++;
      progressManager.incrementSuccess();
    } else {
      failedThisRun++;
      progressManager.incrementFailure();
      
      if (result.errorType === '429') {
        progressManager.incrementRateLimit();
      }
    }
    
    const totalScraped = Object.keys(coursesMap).length;
    
    // Write-through save every SUBJECT_SAVE_INTERVAL courses
    if (totalScraped - lastSaveCount >= SUBJECT_SAVE_INTERVAL) {
      console.log(`  📦 ${subject}: Saving progress (${totalScraped} courses)...`);
      const currentCaches = writer.generateTermData(coursesMap).caches;
      progressManager.saveSubjectFile(subject, coursesMap, currentCaches);
      progressManager.markSubjectPartial(subject, totalScraped, totalForSubject, `${result.course.subject} ${result.course.number}`);
      lastSaveCount = totalScraped;
    }
    
    // Progress display every 10 courses
    if (completed % 10 === 0 || completed === coursesToScrape.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const eta = coursesToScrape.length > completed 
        ? ((coursesToScrape.length - completed) / rate).toFixed(0)
        : '0';
      const overallProgress = progressManager.getTotalCoursesScraped();
      const overallTotal = progressManager.getTotalCoursesExpected();
      const overallPercent = overallTotal > 0 ? ((overallProgress / overallTotal) * 100).toFixed(1) : '?';
      
      console.log(`    Progress: ${completed}/${coursesToScrape.length} in ${subject} (${rate.toFixed(1)}/s, ETA: ${eta}s)`);
      console.log(`    Session: +${successThisRun} this run | Overall: ${overallProgress}/${overallTotal} (${overallPercent}%)`);
    }
    
    // Check for abort
    if (abortRequested) {
      break;
    }
  }
  
  // Handle abort - save progress before exit
  if (abortRequested) {
    const totalScraped = Object.keys(coursesMap).length;
    console.log(`\n💾 Saving progress before abort...`);
    const currentCaches = writer.generateTermData(coursesMap).caches;
    progressManager.saveSubjectFile(subject, coursesMap, currentCaches);
    progressManager.markSubjectPartial(subject, totalScraped, totalForSubject, 'ABORTED');
    progressManager.saveProgress();
    
    console.log(`  ✓ ${subject}.json saved (${totalScraped}/${totalForSubject} courses)`);
    console.log(`  ✓ progress.json updated\n`);
    
    logResumeInstructions(progressManager, subject, totalScraped, totalForSubject);
    
    return { success: false, aborted: true, courses: coursesMap };
  }
  
  // Subject complete - final save
  const currentCaches = writer.generateTermData(coursesMap).caches;
  progressManager.saveSubjectFile(subject, coursesMap, currentCaches);
  progressManager.markSubjectCompleted(subject);
  
  const totalScraped = Object.keys(coursesMap).length;
  console.log(`  ✅ ${subject} complete! (${totalScraped} courses, +${successThisRun} this run, ${failedThisRun} failed)`);
  
  return { success: true, aborted: false, courses: coursesMap };
}

/**
 * Log resume instructions after abort
 */
function logResumeInstructions(
  progressManager: ProgressManager,
  currentSubject: string,
  scrapedInSubject: number,
  totalInSubject: number
): void {
  const overallProgress = progressManager.getTotalCoursesScraped();
  const overallTotal = progressManager.getTotalCoursesExpected();
  
  console.log(`📋 Resume instructions:`);
  console.log(`  - Wait before retrying (24 hours recommended)`);
  console.log(`  - Run same command again to resume`);
  console.log(`  - Progress: ${scrapedInSubject}/${totalInSubject} courses in ${currentSubject}`);
  console.log(`  - Overall: ${overallProgress}/${overallTotal} courses total\n`);
}

/**
 * Main entry point for UIUC Crawler v3
 */
async function main() {
  console.log('🚀 UIUC Crawler v3 - Bulk Scraping Mode\n');
  console.log(`Configuration:`);
  console.log(`  - CONCURRENCY: ${CONCURRENCY}`);
  console.log(`  - REQUEST_DELAY_MS: ${REQUEST_DELAY_MS}`);
  console.log(`  - SUBJECT_SAVE_INTERVAL: ${SUBJECT_SAVE_INTERVAL}`);
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

  // Write indextemp.json with discovered terms
  console.log('📝 Writing indextemp.json with discovered terms...');
  const terms = termsToScrape.map(({ year, term }) => ({
    term: getTermCode(year, term),
    name: getTermName(year, term)
  }));
  writeIndexTemp(terms, OUTPUT_DIR);
  console.log('✅ indextemp.json written (will promote to index.json when ALL terms complete)\n');

  const completedTerms: string[] = [];
  let anyTermFailed = false;

  for (const { year, term } of termsToScrape) {
    const termCode = getTermCode(year, term);
    const termName = getTermName(year, term);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📅 Processing ${termName.toUpperCase()}...`);
    console.log('='.repeat(60) + '\n');
    
    // Initialize progress manager for this term
    const progressManager = new ProgressManager(OUTPUT_DIR, termCode, termName, year, term);
    
    // Check for existing progress
    console.log('🔍 Checking for existing progress...');
    progressManager.logResumeStatus();
    
    try {
      // Step 1: Get all subjects
      console.log('\n🔍 Step 1: Discovering subjects...');
      let subjects: string[];
      
      // Check if we have cached subjects in progress
      const cachedSubjects = progressManager.getCachedSubjects();
      if (cachedSubjects && cachedSubjects.length > 0) {
        subjects = cachedSubjects;
        console.log(`  ✓ Loaded ${subjects.length} subjects from cache (skipped HTTP request)`);
      } else {
        subjects = await scrapeSubjects(year, term);
        console.log(`  ✓ Discovered ${subjects.length} subjects`);
        
        // Cache subjects in progress file
        progressManager.cacheSubjects(subjects);
      }
      
      if (subjects.length === 0) {
        console.log(`  ⚠️  No subjects found for ${term} ${year}, skipping...`);
        continue;
      }

      // Step 2: Get all courses for each subject (discovery phase)
      console.log('\n🔍 Step 2: Discovering courses per subject...');
      let subjectCourseMap = new Map<string, CourseInfo[]>();
      let totalCoursesDiscovered = 0;
      
      // Check if we have cached course lists
      const cachedCourseLists = progressManager.getCachedCourseLists();
      if (cachedCourseLists && Object.keys(cachedCourseLists).length > 0) {
        // Load from cache
        for (const [subject, courses] of Object.entries(cachedCourseLists)) {
          subjectCourseMap.set(subject, courses);
          totalCoursesDiscovered += courses.length;
        }
        console.log(`  ✓ Loaded course lists from cache (${totalCoursesDiscovered} courses, skipped HTTP requests)`);
      } else {
        // Discover courses from HTTP
        let subjectIndex = 0;
        
        for (const subject of subjects) {
          subjectIndex++;
          
          const courses = await scrapeCourseList(year, term, subject);
          
          let coursesToStore = courses;
          if (COURSES_PER_SUBJECT !== null && courses.length > 0) {
            coursesToStore = courses.slice(0, COURSES_PER_SUBJECT);
            console.log(`    ✓ ${subject}: ${courses.length} courses (taking first ${coursesToStore.length})`);
          } else {
            console.log(`    ✓ ${subject}: ${courses.length} courses`);
          }
          
          subjectCourseMap.set(subject, coursesToStore);
          totalCoursesDiscovered += coursesToStore.length;
          
          // Show progress every 20 subjects
          if (subjectIndex % 20 === 0 || subjectIndex === subjects.length) {
            console.log(`  📊 Discovery: ${subjectIndex}/${subjects.length} subjects (${totalCoursesDiscovered} courses found)`);
          }
          
          // Delay between subject discovery requests
          await sleep(500, 0.3);
        }
        
        console.log(`\n  📚 Total courses discovered: ${totalCoursesDiscovered}`);
        
        // Cache the course lists
        const courseListsObj: Record<string, CourseInfo[]> = {};
        subjectCourseMap.forEach((courses, subject) => {
          courseListsObj[subject] = courses;
        });
        progressManager.cacheCourseLists(courseListsObj);
      }
      
      // Update progress with totals
      progressManager.updateTotals(subjects.length, totalCoursesDiscovered);
      
      if (totalCoursesDiscovered === 0) {
        console.log(`  ⚠️  No courses found for ${term} ${year}, skipping...`);
        continue;
      }

      // Step 3: Scrape courses per subject with write-through caching
      console.log('\n🔍 Step 3: Scraping courses per subject (with write-through caching)...\n');
      
      const writer = new DataWriter();
      let termAborted = false;
      let subjectIndex = 0;
      
      for (const subject of subjects) {
        subjectIndex++;
        
        // Skip completed subjects
        if (progressManager.isSubjectCompleted(subject)) {
          console.log(`  ⏭️  ${subject}: Skipping (already complete)`);
          continue;
        }
        
        const coursesInSubject = subjectCourseMap.get(subject) || [];
        if (coursesInSubject.length === 0) {
          progressManager.markSubjectCompleted(subject);
          continue;
        }
        
        // Load existing courses for this subject (resume support)
        const existingCourses = progressManager.getScrapedCourses(subject);
        
        console.log(`\n📦 Processing ${subject} (${subjectIndex}/${subjects.length} subjects)...`);
        
        // Scrape this subject
        const result = await scrapeSubjectCourses(
          year,
          term,
          subject,
          coursesInSubject,
          existingCourses,
          progressManager,
          writer,
          subjectIndex,
          subjects.length
        );
        
        if (result.aborted) {
          termAborted = true;
          anyTermFailed = true;
          break;
        }
      }
      
      // If term was aborted, exit
      if (termAborted) {
        console.error(`\n❌ Term ${termName} aborted due to 403 error`);
        console.error(`   Run again to resume from where you left off\n`);
        process.exit(1);
      }

      // Step 4: Merge all subject files and generate final term JSON
      console.log('\n📦 Step 4: Merging all subjects and building final term data...');
      
      // Merge all subject files - includes courses and caches
      const merged = progressManager.mergeAllSubjects();
      const allCourses = merged.courses;
      const mergedCaches = merged.caches;
      
      // Build final term data with merged caches
      const termData = {
        courses: allCourses,
        caches: mergedCaches,
        updatedAt: new Date().toISOString(),
        version: 3
      };
      
      const totalCourses = Object.keys(allCourses).length;
      const stats = progressManager.getStats();
      
      console.log(`  ✓ Total courses: ${totalCourses}`);
      console.log(`  ✓ Success: ${stats.successfulCourses}, Failed: ${stats.failedCourses}`);
      console.log(`  ✓ Rate limits encountered: ${stats.rateLimitCount}`);
      console.log(`  ✓ Cached periods: ${mergedCaches.periods.length}`);
      console.log(`  ✓ Cached locations: ${mergedCaches.locations.length}`);
      console.log(`  ✓ Cached scheduleTypes: ${mergedCaches.scheduleTypes.length}`);

      // Write final term data JSON
      console.log('\n💾 Writing final output file...');
      const finalWriter = new DataWriter();
      finalWriter.writeTermData(termData, termCode, OUTPUT_DIR);
      
      // Cleanup temporary files
      console.log('🧹 Cleaning up temporary files...');
      progressManager.cleanup();

      completedTerms.push(termCode);
      console.log(`\n✨ ${termName} complete!`);

    } catch (error: any) {
      console.error(`\n❌ Failed to process ${term} ${year}:`, error.message);
      console.error(error);
      anyTermFailed = true;
    }
  }

  // Final index.json handling
  console.log('\n' + '='.repeat(60));
  
  if (completedTerms.length === termsToScrape.length && !anyTermFailed) {
    // All terms completed successfully - promote index
    console.log('✅ All terms completed successfully!');
    console.log('📝 Promoting indextemp.json → index.json...');
    
    if (promoteIndexTemp(OUTPUT_DIR)) {
      console.log('✅ index.json updated');
    } else {
      console.error('❌ Failed to promote index.json');
    }
  } else {
    console.log(`⚠️  Not all terms completed (${completedTerms.length}/${termsToScrape.length})`);
    console.log('   indextemp.json NOT promoted to index.json');
    console.log('   Existing index.json (if any) remains unchanged');
  }
  
  console.log('='.repeat(60));

  console.log('\n✨ Crawling session complete!\n');
  console.log(`📂 Output directory: ${OUTPUT_DIR}`);
  console.log(`📄 Files created/updated:`);
  completedTerms.forEach(termCode => {
    console.log(`   - ${termCode}.json`);
  });
  if (completedTerms.length === termsToScrape.length && !anyTermFailed) {
    console.log(`   - index.json`);
  } else {
    console.log(`   - indextemp.json (not promoted)`);
  }
}

// Run the crawler
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
