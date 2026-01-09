import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";
import {
  AnyScheduleVersion,
  AnyScheduleData,
  FriendData,
} from "../utils/types";

const friendsCollection = admin
  .firestore()
  .collection("friends") as FirebaseFirestore.CollectionReference<FriendData>;

const auth = admin.auth();
const schedulesCollection = admin
  .firestore()
  .collection(
    "schedules"
  ) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

const corsHandler = cors({ origin: true });

type ScheduleVersionPayload = {
  versions: Record<string, Partial<AnyScheduleVersion>>;
};

type SchedulePayload = Record<string, ScheduleVersionPayload>;

export const fetchFriendSchedules = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        // This request should be made with content type is application/x-www-form-urlencoded.
        // This is done to prevent a pre-flight CORS request made to the firebase function
        // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
        request.body = JSON.parse(request.body.data);
      } catch {
        response.status(401).json(apiError("Bad request"));
      }

      const { IDToken, friends, term } = request.body;

      if (IDToken == null) {
        response.status(401).json(apiError("IDToken not provided"));
        return;
      }

      if (
        term == null ||
        friends == null ||
        Object.keys(friends).length === 0
      ) {
        return response.status(400).json(apiError("Invalid request"));
      }

      let decodedToken: admin.auth.DecodedIdToken;
      try {
        decodedToken = await auth.verifyIdToken(IDToken);
      } catch {
        return response.status(400).json(apiError("Request not authorized"));
      }

      const userId = decodedToken.uid;

      const userFriendData = (await friendsCollection
        .doc(userId)
        .get()
        .then((doc) => doc.data())) as FriendData;

      if (
        !userFriendData ||
        !userFriendData.terms ||
        !userFriendData.terms[term] ||
        !userFriendData.terms[term].accessibleSchedules
      ) {
        return response
          .status(400)
          .json(apiError("Could not fetch friend data"));
      }

      const accessibleSchedules =
        userFriendData.terms[term].accessibleSchedules;
      const friendIds = Object.keys(friends);

      // validate user has access to the requested friends' schedules
      const validFriends = new Set(Object.keys(accessibleSchedules));
      if (friendIds.some((friendId: string) => !validFriends.has(friendId))) {
        return response.status(400).json(apiError("Invalid friend ID(s)"));
      }

      const friendSchedulePayload: SchedulePayload = {};

      await Promise.all(
        friendIds.map(async (friendId: string) => {
          friendSchedulePayload[friendId] = {
            versions: {},
          };

          // fetch friend's schedules
          const friendScheduleData = (await schedulesCollection
            .doc(friendId)
            .get()
            .then((doc) => doc.data())) as AnyScheduleData;

          // no schedules found
          if (
            !friendScheduleData ||
            !friendScheduleData.terms ||
            !friendScheduleData.terms[term] ||
            !friendScheduleData.terms[term].versions
          ) {
            // clean up - remove all invalid version IDs
            delete accessibleSchedules[friendId];
            return;
          }

          // obtain schedules
          const scheduleVersions = friendScheduleData.terms[term].versions;

          const accessibleVersionIds = new Set(accessibleSchedules[friendId]);
          const requestedVersionIds = new Set(friends[friendId]);

          friendSchedulePayload[friendId].versions = Object.fromEntries(
            Object.entries(scheduleVersions)
              .filter(
                ([versionId]) =>
                  requestedVersionIds.has(versionId) &&
                  accessibleVersionIds.has(versionId)
              )
              .map(([versionId, scheduleVersion]) => {
                const { name, schedule } = scheduleVersion;
                return [versionId, { name, schedule }];
              })
          );

          // clean up - filter invalid version IDs
          const allVersionIds = new Set(Object.keys(scheduleVersions));
          accessibleSchedules[friendId] = accessibleSchedules[friendId].filter(
            (versionId: string) => allVersionIds.has(versionId)
          );

          return;
        })
      ).catch((err) => response.status(400).json(apiError(err)));

      // clean up - remove invalid version IDs from friend data
      await friendsCollection.doc(userId).set(userFriendData);

      return response.status(200).json(friendSchedulePayload);
    });
  });
