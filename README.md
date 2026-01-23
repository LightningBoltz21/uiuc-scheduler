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
| Backend API | Express.js, TypeScript (Azure Functions) |
| Database | Firebase Firestore |
| Serverless | Firebase Cloud Functions |
| Course Data | Custom web scraper (Node.js) |
| Hosting | GitHub Pages (website), Firebase (functions) |
| CI/CD | GitHub Actions |
| Analytics | Google Analytics |
| Error Tracking | Sentry |

## Quick Start

### Prerequisites

- Node.js 18+
- Yarn v1 (for website)
- npm (for crawler and firebase functions)
- Firebase CLI (`npm install -g firebase-tools`)

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

# Run the crawler
npm start
```

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

Express API server deployed on Azure Functions. Provides a proxy endpoint to fetch real-time section availability (Open/Closed/Restricted) from courses.illinois.edu.

### Crawler v3 (`apps/crawler-v3/`)

Web scraper that collects course data from courses.illinois.edu and generates JSON files for the frontend. Runs weekly via GitHub Actions. See [apps/crawler-v3/README.md](apps/crawler-v3/README.md) for detailed documentation.

### Firebase Configuration (`infra/firebase-conf/`)

Firebase Cloud Functions for:
- Schedule storage and retrieval
- Friend invitation system
- Schedule sharing
- Automated Firestore backups

## Deployment

### Website Deployment

The website automatically deploys to GitHub Pages when changes are pushed to the `main` branch.

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

Create `.env` in `apps/website/`:
```
REACT_APP_SENTRY_DSN=<your-sentry-dsn>
REACT_APP_FIREBASE_API_KEY=<firebase-api-key>
REACT_APP_FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>
REACT_APP_FIREBASE_PROJECT_ID=<firebase-project-id>
REACT_APP_FIREBASE_STORAGE_BUCKET=<firebase-storage-bucket>
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=<firebase-messaging-sender-id>
REACT_APP_FIREBASE_APP_ID=<firebase-app-id>
REACT_APP_FIREBASE_MEASUREMENT_ID=<firebase-measurement-id>
REACT_APP_MAPBOX_TOKEN=<mapbox-token>
```

### Firebase Functions

Environment variables are managed via Firebase Functions configuration or GitHub Secrets for deployment.

## Contributing

We welcome contributions from the UIUC community! Please read the following guidelines:

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the existing code style
3. **Run linting** before committing: `yarn lint` or `npm run lint`
4. **Submit a pull request** with a clear description of changes

For major changes, please open an issue first to discuss the proposed modifications.

### Code Style

- TypeScript for all new code
- ESLint + Prettier for formatting
- Pre-commit hooks enforce code quality

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
