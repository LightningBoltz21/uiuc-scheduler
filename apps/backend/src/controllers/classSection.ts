import { Request, Response } from "express";
import axios from "axios";
import * as cheerio from "cheerio";

const UIUC_BASE_URL = "https://courses.illinois.edu";

interface SectionData {
  crn: string;
  availability: string;
  status: string;
  restricted?: string;
}

/**
 * Proxy Controller to fetch real-time section availability from UIUC Course Explorer
 *
 * Query params:
 * - term: e.g., "202602" (YYYYMM format)
 * - subject: e.g., "CS"
 * - courseNumber: e.g., "124"
 * - crn: e.g., "12345"
 *
 * Returns:
 * {
 *   crn: string,
 *   availability: string,  // Raw text: "Open", "Closed", "Restricted", etc.
 *   status: "open" | "closed" | "restricted",  // Normalized status
 *   restrictions: string,
 *   lastUpdated: string
 * }
 *
 * NOTE: UIUC does NOT provide seat counts or enrollment numbers in sectionDataObj
 */
export const ClassSectionProxy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { term, subject, courseNumber, crn } = req.query;

  if (!term || !subject || !courseNumber || !crn) {
    return res.status(400).send({
      message:
        "Missing required query parameters: term, subject, courseNumber, crn",
    });
  }

  try {
    // Convert term format: 202602 -> 2026/spring
    const termStr = String(term);
    const year = termStr.substring(0, 4);
    const monthCode = termStr.substring(4, 6);

    const semesterMap: Record<string, string> = {
      '01': 'spring',
      '02': 'spring',
      '05': 'summer',
      '06': 'summer',
      '08': 'fall',
      '09': 'fall',
      '12': 'winter'
    };

    const semester = semesterMap[monthCode];

    if (!year || !semester) {
      return res.status(400).send({
        message: "Invalid term format. Expected: YYYYMM (e.g., 202602 for Spring 2026)",
      });
    }

    const url = `${UIUC_BASE_URL}/schedule/${year}/${semester}/${subject}/${courseNumber}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });

    const html = response.data;

    // Extract sectionDataObj from the embedded JavaScript
    // Using [\s\S] instead of . with s flag for ES2017 compatibility
    const sectionDataMatch = html.match(/var sectionDataObj = (\[[\s\S]*?\]);/);

    if (!sectionDataMatch) {
      return res.status(404).send({
        message: "Could not find section data on page",
      });
    }

    const sectionData: SectionData[] = JSON.parse(sectionDataMatch[1]);

    // Find the section by CRN
    const section = sectionData.find((s) => s.crn === String(crn));

    if (!section) {
      return res.status(404).send({
        message: `Section with CRN ${crn} not found`,
      });
    }

    // Parse the availability status
    const availability = section.availability || "Unknown";

    // Parse restriction info if present
    let restrictions = "";
    if (section.restricted) {
      const $restricted = cheerio.load(section.restricted);
      restrictions = $restricted.text().trim();
    }

    // Normalize to standard status
    let statusCategory: "open" | "closed" | "restricted" = "open";
    const availLower = availability.toLowerCase();
    if (availLower.includes("closed")) {
      statusCategory = "closed";
    } else if (availLower.includes("restricted") || availLower.includes("reserved")) {
      statusCategory = "restricted";
    }

    res.setHeader("Last-Modified", new Date().toUTCString());
    res.setHeader("Cache-Control", "max-age=300"); // Cache for 5 minutes

    return res.status(200).json({
      crn: section.crn,
      availability,
      status: statusCategory,
      restrictions,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Error fetching section data:", err.message);
    return res.status(502).send({
      message: `Failed to fetch section data: ${err.message}`,
    });
  }
};
