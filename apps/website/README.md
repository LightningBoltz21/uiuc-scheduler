# UIUC Scheduler

> UIUC Scheduler lets you find the schedule that fits you best among all the possible combinations of courses.

## 📃 License & Copyright Notice

This work is a derivative of the original and spectacular [GT Scheduler](https://github.com/64json/gt-scheduler) project created by Jinseo Park and developed by Bits of Good. The original work and all modifications are licensed under the [AGPL v3.0](https://github.com/64json/gt-scheduler/blob/master/LICENSE) license.

### Original Work

Copyright (c) 2020 Jinseo Park (parkjs814@gmail.com)
Copyright (c) 2020 the Bits of Good "GT Scheduler" team

### UIUC Modifications

Copyright (c) 2024 Anish Malepati and Aneesh Kalla

## 🔍 Overview

The app is a React single-page application (SPA) (built using [`create-react-app`](https://github.com/facebook/create-react-app)) that forms the frontend website users interact with when they go to https://uiucscheduler.org/. It is written in [TypeScript](https://www.typescriptlang.org/) (a typed superset of JavaScript), and uses [SCSS](https://sass-lang.com/) for styling (a superset of CSS that supports advanced features).

To implement its goal of facilitating schedule creation and class exploration, UIUC Scheduler stores all schedule data **locally in the browser's local storage** (older versions used cookies; the data is migrated forward automatically). Then, it sources any relevant data at runtime from a variety of sources, such as:

- The list of terms (strings like `202502`, which corresponds to Spring 2025) that have been scraped by the [Crawler application](../crawler-v3): https://uiucscheduler.org/index.json
- The data for a single term, which is the full output of the Crawler application in a single JSON file: https://uiucscheduler.org/202502.json

Once features are merged into the `main` branch, they are automatically built and published to [GitHub Pages](https://pages.github.com/) by the [deploy workflow](../../.github/workflows/deploy-website.yml) at the repository root, which serves the public site at https://uiucscheduler.org/ (fronted by Cloudflare). That workflow also downloads the crawler's JSON output from the `gh-pages` branch into the build, so the term data served alongside the site is refreshed on every deploy.

The website uses [Google Analytics](https://marketingplatform.google.com/about/analytics/) for aggregate analytics and information about how many people are using the app. It also utilizes [Sentry](https://sentry.io/welcome/) for automatic error reporting.

## 🚀 Running Locally

### Requisite software

- [Node.js](https://nodejs.org/en/) (any recent version will probably work)
- Installation of the [`yarn` package manager](https://classic.yarnpkg.com/en/docs/install/) **version 1** (support for version 2 is untested)

### Running the app

After cloning the repository to your local computer, run the following command in the repo folder:

```
yarn install
```

This may take a couple minutes and will create a new folder called `node_modules` with all of the dependencies installed within. This only needs to be run once.

Then, to start a local development version of the frontend app, run:

```
yarn start
```

The app should then be viewable at [http://localhost:3000](http://localhost:3000), which you can open a new browser tab to view.

With that, you're able to make changes to the code and have them be re-built and viewable after a short delay in the same tab. This is the main workflow for adding new features or fixing bugs and testing them in the actual app.

> **Warning**
>
> When running the development server (and when building the site),
> a large number of warnings may appear in the console that look something like:
>
> ```
> WARNING in ./node_modules/parse5/dist/common/token.js
> Module Warning (from ./node_modules/source-map-loader/dist/cjs.js):
> Failed to parse source map from '.../website/node_modules/parse5/dist/common/token.js.map' file: Error: ENOENT: no such file or directory, open '.../website/node_modules/parse5/dist/common/token.js.map'
>  @ ./node_modules/parse5/dist/index.js 13:0-44 14:0-27
>  @ ...
> ```
>
> **These can be safely ignored.**
>
> They are due to a combination of misconfiguration in a few transitive dependencies
> (such as `parse5`, `/@firebase/auth`, and `exponential-backoff`)
> and the overzealousness of `create-react-app`'s default configuration in reporting non-issues.
>
> See https://github.com/facebook/create-react-app/discussions/11767 for more details.

### Linting

The project uses pre-commit hooks using [Husky](https://typicode.github.io/husky/#/) and [`lint-staged`](https://www.npmjs.com/package/lint-staged) to run linting (via [ESLint](https://eslint.org/)) and formatting (via [Prettier](https://prettier.io/)). These can be run manually from the command line to format/lint the code on-demand, using the following commands:

- `yarn run lint` - runs ESLint and reports all linting errors without fixing them
- `yarn run lint:fix` - runs ESLint and reports all linting errors, attempting to fix any auto-fixable ones
- `yarn run format` - runs Prettier and automatically formats the entire codebase
- `yarn run format:check` - runs Prettier and reports formatting errors without fixing them

## 👩‍💻 Contributing

The UIUC Scheduler project welcomes (and encourages) contributions from the community. Regular development is performed by the project owners (Anish Malepati and Aneesh Kalla), but we still encourage others to work on adding new features or fixing existing bugs and make the registration process better for the UIUC community.

More information on how to contribute can be found [in the contributing guide](../../CONTRIBUTING.md) at the repository root.
