import * as functions from "firebase-functions";
import * as date from "date-and-time";
import * as fetch from "node-fetch";
import * as zlib from "zlib";
import * as util from "util";
import { Response } from "express";
import admin from "./firebase";
import * as cors from "cors";
import { apiError } from "./api";

const UPSTREAM_COURSE_DATA_URL =
  "https://c4citk6s9k.execute-api.us-east-1.amazonaws.com/prod/data/course";

// Cache error responses for 1 hour
const CACHE_ERROR_RESPONSE_EXPIRATION_SECONDS = 60 * 60 * 1;
// Cache course data for 6 hours
const CACHE_SUCCESS_RESPONSE_EXPIRATION_SECONDS = 60 * 60 * 24;

const courseDataCacheCollection = admin
  .firestore()
  .collection(
    "course_critique_course_data_cache"
  ) as FirebaseFirestore.CollectionReference<CacheItem>;

type CacheItem = {
  // ISO 8601 date-time that the item was added
  t: string;
  // Schema version
  // (old versions are ignored)
  v: 1;
  // Opaque Course Critique API response string,
  // brotli-compressed before being stored
  d: string;
  // Opaque Course Critique API status code
  s: number;
  // The content-type of the response string
  c: string;
};

// Right now, this always allows the requesting origin.
// Nothing sensitive is served from this function,
// so this is fine to use.
// Not restricting the origin to gt-scheduler.org
// makes it easier to develop locally by using the same API endpoint.
const corsHandler = cors({ origin: true });

// Optimization: provide a global in-memory cache for this process
// that can be used across multiple invocations
// that get scheduled on the same process
const globalCache: Record<string, CacheItem> = {};

export const getCourseDataFromCourseCritique = functions
  .region("us-east1")
  .https.onRequest((request, response) =>
    corsHandler(request, response, async () => {
      // Get the course ID from the request
      const courseID = request.query["courseID"];
      if (courseID == null || courseID.length === 0) {
        response
          .status(400)
          .json(apiError("request missing 'courseID' query parameter"));
        return;
      } else if (typeof courseID !== "string") {
        response
          .status(400)
          .json(
            apiError(
              "request should contain a single 'courseID' query parameter"
            )
          );
        return;
      } else if (courseID.length > 16) {
        // No valid course IDs are longer than 16 characters
        // (just place some upper limit on them).
        response
          .status(400)
          .json(
            apiError(
              "'courseID' query parameter is too long (must be <= 16 characters)"
            )
          );
        return;
      }

      // Optimization: check to see if the course has a cached value
      // in the in-memory cache
      const globalCacheItem = getCacheItemFromGlobalCache(courseID);
      if (globalCacheItem !== null) {
        const age = getCacheItemAge(globalCacheItem);
        if (age < getCacheItemExpirationSeconds(globalCacheItem)) {
          // Use this log line to construct custom metrics
          // so we can observe how often the global cache is used:
          // https://cloud.google.com/logging/docs/logs-based-metrics#user-metrics
          functions.logger.info("Using globally cached data for course", {
            course_id: courseID,
            age,
          });

          await sendCachedResponse(response, {
            data: await decompressBody(globalCacheItem.d),
            contentType: globalCacheItem.c,
            status: globalCacheItem.s,
            age,
          });

          return;
        }
      }

      // Check to see if the course has a cached value in Firestore
      const firestoreCacheItem = await getCacheItemFromFirestore(courseID);
      if (firestoreCacheItem !== null) {
        const age = getCacheItemAge(firestoreCacheItem);
        if (age < getCacheItemExpirationSeconds(firestoreCacheItem)) {
          // Use this log line to construct custom metrics
          // so we can observe how often the Firestore cache is used:
          // https://cloud.google.com/logging/docs/logs-based-metrics#user-metrics
          functions.logger.info("Using Firestore cached data for course", {
            course_id: courseID,
            age,
          });

          await sendCachedResponse(response, {
            data: await decompressBody(firestoreCacheItem.d),
            contentType: firestoreCacheItem.c,
            status: firestoreCacheItem.s,
            age,
          });

          return;
        }
      }

      const maybeStale = firestoreCacheItem ?? globalCacheItem;

      // Fetch the upstream data
      const encodedCourseID = encodeURIComponent(courseID);
      const url = `${UPSTREAM_COURSE_DATA_URL}?courseID=${encodedCourseID}`;
      let upstreamResponse: fetch.Response;
      let upstreamResponseBody: string;
      let latencyMs: number;
      try {
        const start = process.hrtime();
        upstreamResponse = await fetch.default(url, {
          method: "GET",
          headers: { "User-Agent": "gt-scheduler-cache-proxy (node-fetch)" },
        });
        upstreamResponseBody = await upstreamResponse.text();
        const stop = process.hrtime(start);

        latencyMs = (stop[0] * 1e9 + stop[1]) / 1e6;
      } catch (err) {
        // There was an error contacting the upstream API
        // (this is not a 3xx-5xx response code).
        // Log the error
        // Use this log line to construct custom metrics
        // so we can observe how often the Course Critique API is down:
        // https://cloud.google.com/logging/docs/logs-based-metrics#user-metrics
        functions.logger.error(
          `An error occurred while making a request to Course Critique: ${err}`,
          { url }
        );

        // If there is cached data (even if stale), return it.
        if (maybeStale !== null) {
          await sendCachedResponse(response, {
            data: await decompressBody(maybeStale.d),
            contentType: maybeStale.c,
            status: maybeStale.s,
            age: getCacheItemAge(maybeStale),
          });

          return;
        }

        // Otherwise, return a 504 (Gateway Timeout)
        response
          .status(504)
          .json(apiError("could not contact upstream Course Critique API"));
        return;
      }

      // Use this log line to construct custom metrics
      // so we can observe the latency and response code
      // of Course Critique API requests:
      // https://cloud.google.com/logging/docs/logs-based-metrics#user-metrics
      functions.logger.info("Made upstream request to Course Critique API", {
        course_id: courseID,
        latency_ms: latencyMs,
        status: upstreamResponse.status,
      });

      // Eagerly send the response before storing the cache item
      const contentType =
        upstreamResponse.headers.get("content-type") ?? "application/json";
      sendCachedResponse(response, {
        data: upstreamResponseBody,
        contentType,
        status: upstreamResponse.status,
        age: 0,
      });

      // Store the timestamp, data, and status code
      // in both Firestore & the global cache
      const timestamp = new Date().toISOString();
      await storeCacheItem(courseID, upstreamResponseBody, {
        v: 1,
        t: timestamp,
        s: upstreamResponse.status,
        c: contentType,
      });
    })
  );

function getCacheItemFromGlobalCache(courseID: string): CacheItem | null {
  const item = globalCache[courseID];
  if (item == null) return null;
  return item;
}

async function getCacheItemFromFirestore(
  courseID: string
): Promise<CacheItem | null> {
  const document = await courseDataCacheCollection.doc(courseID).get();
  if (document.exists) {
    const data = document.data();
    if (data != null) {
      return data;
    }
  }

  return null;
}

const compress = util.promisify(zlib.brotliCompress);
const decompress = util.promisify(zlib.brotliDecompress);

async function compressBody(body: string): Promise<string> {
  return (await compress(body)).toString("base64");
}

async function decompressBody(compressed: string): Promise<Buffer> {
  return await decompress(Buffer.from(compressed, "base64"));
}

function getCacheItemAge(cacheItem: CacheItem): number {
  const now = new Date();
  const timestamp = new Date(cacheItem.t);
  const age = Math.max(0, date.subtract(now, timestamp).toSeconds());
  return Math.floor(age);
}

function getCacheItemExpirationSeconds(cacheItem: CacheItem): number {
  // Use a different expiration if the cached response is an error
  if (cacheItem.s >= 400) {
    return CACHE_ERROR_RESPONSE_EXPIRATION_SECONDS;
  } else {
    return CACHE_SUCCESS_RESPONSE_EXPIRATION_SECONDS;
  }
}

type PreparedCacheResponseData = {
  data: string | Buffer;
  contentType: string;
  status: number;
  age: number;
};

function sendCachedResponse(
  response: Response,
  data: PreparedCacheResponseData
) {
  response
    .status(data.status)
    .header("Content-Type", data.contentType)
    .header("Age", String(Math.floor(data.age)))
    .send(data.data);
}

async function storeCacheItem(
  courseID: string,
  rawBody: string,
  item: Omit<CacheItem, "d">
): Promise<void> {
  const newDocument: CacheItem = {
    ...item,
    d: await compressBody(rawBody),
  };

  globalCache[courseID] = newDocument;
  await courseDataCacheCollection.doc(courseID).set(newDocument);
}
