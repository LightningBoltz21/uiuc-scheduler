# Firebase Configuration

This repository contains the configuration for [Firebase Cloud Firestore](https://firebase.google.com/products/firestore) and the source code for [Firebase Cloud Functions](https://firebase.google.com/products/functions). GT Scheduler's app uses both of these to handle:

- storing schedule data
- read-through caching requests to Course Critique's API

## 🚀 Developing functions

To work with with the Cloud Functions in this repository, run the following commands from within the `/functions` directory (make sure you have Node.js 18+ and Yarn v1 installed beforehand):

```sh
npm install -g firebase-tools
yarn install
yarn build
yarn serve
```

You should then be able to access the [Firebase local emulator suite](https://firebase.google.com/docs/emulator-suite) running at http://localhost:4000/, and run functions at their URLs. For example, to run the `getCourseDataFromCourseCritique` function, you can run the following command:

```sh
curl "http://localhost:5001/gt-scheduler-web-prod/us-central1/getCourseDataFromCourseCritique?courseID=CS%201332"
```
## 🚧 Staging changes

To test changes to firebase config and functions online, you should use the development Firebase app (`gt-scheduler-web-dev`). You'll need to log in to the GT Scheduler FIrebase account (using `firebase login`). Once this is done, run `firebase deploy --project dev` to stage your changes.

## 📦 Deploying changes

To deploy changes (to either the firestore config or functions) to the production Firebase app (`gt-scheduler-web-prod`), you'll need to log in to the GT Scheduler Firebase account (using `firebase login`). Once this is done, simply run `firebase deploy --project prod` in the repository root to deploy all changes.