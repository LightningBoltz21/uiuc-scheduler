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

/** Table holding one row per section on a course page */
const SECTION_TABLE_SELECTOR = "#schedule-course-table";

/**
 * Locate a section row by CRN and read its availability out of the rendered
 * section table.
 *
 * Columns are resolved by header text rather than by position so that a column
 * being added or reordered upstream doesn't silently shift every field.
 */
function findSectionByCrn(html: string, crn: string): SectionData | null {
  const $ = cheerio.load(html);
  const table = $(SECTION_TABLE_SELECTOR);

  const columns: Record<string, number> = {};
  table.find("thead th").each((index, th) => {
    const $th = $(th);
    let label = $th.text().replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) {
      // Sortable columns are labelled like "CRN: Activate to sort"
      const aria = $th.attr("aria-label") || "";
      label = aria.split(":")[0].replace(/\s+/g, " ").trim().toLowerCase();
    }
    if (label && columns[label] === undefined) columns[label] = index;
  });

  const crnColumn = columns.crn;
  if (crnColumn === undefined) return null;

  let match: SectionData | null = null;
  table.find("tbody tr").each((_index, row) => {
    if (match) return;
    const cells = $(row).find("td");
    if ($(cells[crnColumn]).text().trim() !== crn) return;

    // Read the nested definition list in the "Section Details" cell
    const details: Record<string, string> = {};
    const detailIndex = columns["section details"];
    if (detailIndex !== undefined) {
      let label = "";
      $(cells[detailIndex])
        .find("dl")
        .first()
        .children()
        .each((_i, el) => {
          const text = $(el).text().replace(/\s+/g, " ").trim();
          if (el.tagName === "dt") {
            label = text.replace(/:$/, "").toLowerCase();
          } else if (el.tagName === "dd" && label) {
            details[label] = text;
            label = "";
          }
        });
    }

    // Fall back to the status icon, labelled like "Section Open (Restricted)"
    const statusIndex = columns.status;
    const statusLabel =
      statusIndex === undefined
        ? ""
        : $(cells[statusIndex]).find("[aria-label]").attr("aria-label") || "";

    const restrictions = Object.keys(details)
      .filter((label) => label.indexOf("restriction") !== -1)
      .map((label) => details[label])
      .join("; ");

    match = {
      crn,
      availability:
        details.availability || statusLabel.replace(/^Section\s+/i, ""),
      status: "",
      restricted: restrictions,
    };
  });

  return match;
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
      "01": "spring",
      "02": "spring",
      "05": "summer",
      "06": "summer",
      "08": "fall",
      "09": "fall",
      "12": "winter",
    };

    const semester = semesterMap[monthCode];

    if (!year || !semester) {
      return res.status(400).send({
        message:
          "Invalid term format. Expected: YYYYMM (e.g., 202602 for Spring 2026)",
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

    // Sections are rendered server-side into #schedule-course-table.
    // (Course Explorer previously embedded them as a `var sectionDataObj = [...]`
    // JavaScript array; that variable no longer exists.)
    const section = findSectionByCrn(html, String(crn));

    if (!section) {
      return res.status(404).send({
        message: `Section with CRN ${crn} not found`,
      });
    }

    const availability = section.availability || "Unknown";
    const restrictions = section.restricted || "";

    // Normalize to standard status
    let statusCategory: "open" | "closed" | "restricted" = "open";
    const availLower = availability.toLowerCase();
    if (availLower.includes("closed")) {
      statusCategory = "closed";
    } else if (
      availLower.includes("restricted") ||
      availLower.includes("reserved")
    ) {
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
