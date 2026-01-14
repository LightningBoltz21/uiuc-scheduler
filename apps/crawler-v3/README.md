# UIUC Crawler v3

Web scraper for UIUC Course Explorer that generates JSON data for UIUC Scheduler.

## Overview

This crawler scrapes course data from `https://courses.illinois.edu/` and outputs structured JSON files compatible with the UIUC Scheduler frontend.

## Installation

```bash
npm install
```

## Usage

```bash
# Run the crawler
npm start

# Build TypeScript
npm run build
```

## Output

Generated JSON files are stored in the `data/` directory:
- `202502.json` - Course data for Spring 2025
- `index.json` - List of available terms

## Data Format

The output follows the GT Scheduler crawler format with tuple-based structures and shared caches to minimize JSON size.

### Building Coordinates Data

The `coordinates.csv` file contains building location data for mapping course locations. Building coordinates and addresses were sourced from the [UIUC Campus Building Database](https://answers.uillinois.edu/illinois/57128).

CSV Format:
- **Place ID**: UIUC's internal building identifier
- **Title**: Building name (must match course location strings for proper mapping)
- **Latitude/Longitude**: Geographic coordinates
- **Address**: Full street address

## Development

Currently hardcoded to scrape:
- Term: Fall 2025 (202508)
- Subject: CS
- Course: 100

Future enhancements will add multi-course/multi-department support.
