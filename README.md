# UIUC Scheduler

> A course scheduling tool that helps UIUC students find the perfect schedule among all possible combinations of courses.

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fuiucscheduler.org)](https://uiucscheduler.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Overview

UIUC Scheduler is a web application designed for University of Illinois Urbana-Champaign students to streamline the course registration process. It automatically generates all possible schedule combinations based on selected courses, allowing students to quickly find schedules that fit their preferences.

**Key Features:**
- Automatic schedule generation from course selections
- Visual calendar view with drag-and-drop customization
- GPA data integration for course planning
- Schedule sharing with friends
- Export schedules to calendar formats (ICS)
- Dark/Light mode support

## Architecture

```
uiuc-scheduler/
├── apps/
│   ├── website/          # React frontend (SPA)
│   ├── backend/          # Express API server (Azure Functions)
│   └── crawler-v3/       # Course data scraper
├── infra/
│   └── firebase-conf/    # Firebase Functions & Firestore config
└── gpa_stuff/            # GPA data processing utilities
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript, SCSS |
| Backend API | Azure Functions (Node.js, TypeScript) |
| Database | Firebase Firestore |
| Serverless | Firebase Cloud Functions (`us-east1`) |
| Course Data | Custom web scraper (Node.js) |
| Hosting | GitHub Pages + Cloudflare (website), Azure (API), Firebase (functions) |
| CI/CD | GitHub Actions |
| Analytics | Google Analytics |
| Error Tracking | Sentry |

## Quick Start

### Prerequisites

- Node.js 18+ (CI builds the website on 18, the crawler and Firebase functions on 20, and the backend on 24)
- Yarn v1 (for website)
- npm (for crawler, backend, and firebase functions)
- Firebase CLI (`npm install -g firebase-tools`), for Firebase functions
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`), for the backend

### Running the Website Locally

```bash
# Clone the repository
git clone https://github.com/LightningBoltz21/uiuc-scheduler.git
cd uiuc-scheduler/apps/website

# Install dependencies
yarn install

# Start development server
yarn start
```

The website will be available at http://localhost:3000

### Running the Crawler

```bash
cd apps/crawler-v3

# Install dependencies
npm install

# Building coordinates are read from data/coordinates.csv
mkdir -p data && cp coordinates.csv data/coordinates.csv

# Run the crawler (must be run from apps/crawler-v3)
npm start
```

A full scrape is long and UIUC rate-limits aggressively, so the crawler saves progress as it goes and resumes where it left off if re-run. Behavior is configured entirely through environment variables — `SPECIFIED_TERMS`, `CONCURRENCY`, `REQUEST_DELAY_MS`, and the `MAX_SUBJECTS` / `COURSES_PER_SUBJECT` testing limits.

### Running Firebase Functions Locally

```bash
cd infra/firebase-conf/functions

# Install dependencies
npm install

# Build and serve with emulator
npm run serve
```

Access the emulator UI at http://localhost:4000

## Project Components

### Website (`apps/website/`)

The main React single-page application.

### Backend (`apps/backend/`)

An Azure Function (`/api/classSection`) that fetches real-time section availability (Open/Closed/Restricted) from courses.illinois.edu on behalf of the website, with a 5-minute cache. Note that Course Explorer does not expose numeric seat counts — only availability status. The Express server under `src/` is inherited from GT Scheduler and is wrapped by the Azure handler rather than deployed on its own. See [AZURE_SETUP.md](AZURE_SETUP.md).

### Crawler v3 (`apps/crawler-v3/`)

Web scraper that collects course data from courses.illinois.edu and generates JSON files for the frontend. Runs weekly via GitHub Actions. See [apps/crawler-v3/README.md](apps/crawler-v3/README.md) for detailed documentation.

### Firebase Configuration (`infra/firebase-conf/`)

Firestore rules and Firebase Cloud Functions for:
- Friend invitation system (creation, links, acceptance)
- Fetching and deleting shared schedules
- Automated Firestore backups

Schedules themselves are read and written directly from the browser to Firestore; the functions exist for the cross-user operations that Firestore rules deliberately forbid the client from doing.

## Deployment

### Website Deployment

The website automatically deploys to GitHub Pages when changes under `apps/website/` are pushed to the `main` branch. The workflow also downloads the crawler's JSON output from the `gh-pages` branch into the build, so the term data served with the site is refreshed on each deploy, and purges the Cloudflare cache afterward.

### Backend Deployment

The Azure Function deploys automatically when changes under `apps/backend/` are pushed to `main`.

### Firebase Functions Deployment

```bash
cd infra/firebase-conf
firebase login
firebase deploy --project default
```

### Crawler Deployment

The crawler runs automatically via GitHub Actions every Monday at midnight UTC (might change in future). It can also be triggered manually via workflow dispatch.

## Environment Variables

### Website

All website environment variables are prefixed with `REACT_APP_` and are baked into the published bundle, so none of them are secret.

Create `.env` in `apps/website/`:
```
REACT_APP_FIREBASE_API_KEY=<firebase-api-key>
REACT_APP_FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>
REACT_APP_FIREBASE_PROJECT_ID=<firebase-project-id>
REACT_APP_FIREBASE_STORAGE_BUCKET=<firebase-storage-bucket>
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=<firebase-messaging-sender-id>
REACT_APP_FIREBASE_APP_ID=<firebase-app-id>
REACT_APP_FIREBASE_MEASUREMENT_ID=<firebase-measurement-id>
REACT_APP_MAPBOX_TOKEN=<mapbox-token>
```

All of these are optional for local development. If `REACT_APP_FIREBASE_API_KEY` is unset, Firebase is never initialized and the app runs entirely on local storage, with account login and schedule sharing disabled. Without `REACT_APP_MAPBOX_TOKEN`, the map view will not render tiles.

Two additional variables are useful when developing against local services:

```
REACT_APP_LOCAL_CRAWLER_URL=<url>    # serve crawler output locally instead of uiucscheduler.org
REACT_APP_AZURE_FUNCTION_URL=<url>   # point live availability at a local `func start`
```

The Sentry DSN is not configured via environment variable; it is hardcoded in [apps/website/src/index.tsx](apps/website/src/index.tsx) and Sentry is only initialized in production builds. CI additionally sets `REACT_APP_SENTRY_VERSION` to the commit SHA to tag the release.

### Firebase Functions

Environment variables are managed via Firebase Functions configuration or GitHub Secrets for deployment.

## Contributing

We welcome contributions from the UIUC community! See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

The short version:

1. **Open an issue** first for anything substantial, so the approach can be agreed on
2. **Fork the repository** and create a branch named `[your-first-name]/[issue-#]-[slug]`
3. **Make your changes** in TypeScript, following the existing code style
4. **Run the checks** for the app you touched — `yarn lint && yarn format:check`, plus `yarn test` for the website. There is no CI, so these only run if you run them.
5. **Submit a pull request** against `main` describing what changed and how to test it

`apps/website` and `apps/backend` install Husky pre-commit hooks that lint and format staged files automatically once their dependencies are installed.

## License

This project is licensed under the [AGPL v3.0](LICENSE) license.

## Acknowledgments

UIUC Scheduler is a derivative of the amazing [GT Scheduler](https://github.com/gt-scheduler) project.

### Original Work

Created by [Jinseo Park](https://github.com/64json), [Bits of Good](https://bitsofgood.org/), and the GT Scheduler contributors.

### UIUC Modifications

- Copyright (c) 2026 Anish Malepati and Aneesh Kalla

We are grateful to the GT Scheduler team for creating and open-sourcing the original project that made this possible.

## Support

- **Bug Reports**: [Create an issue](https://github.com/LightningBoltz21/uiuc-scheduler/issues/new)
- **Feature Requests**: [Create an issue](https://github.com/LightningBoltz21/uiuc-scheduler/issues/new)

---

Made with care for the UIUC community
