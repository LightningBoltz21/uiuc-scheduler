import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  AnyScheduleData,
  FriendData,
  Version3ScheduleData,
  FriendInviteData,
} from "../utils/types";

const auth = admin.auth();
const firestore = admin.firestore();
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

const friendsCollection = firestore.collection(
  "friends"
) as FirebaseFirestore.CollectionReference<FriendData>;

const corsHandler = cors({ origin: true });

/* This endpoint is called when a user clicks on an invitation link - checks if invites are valid and handles accepting them*/
export const handleFriendInvitation = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          // This request should be made with content type is application/x-www-form-urlencoded.
          // This is done to prevent a pre-flight CORS request made to the firebase function
          // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
          request.body = JSON.parse(request.body.data);
        } catch {
          return response.status(401).json(apiError("Bad request"));
        }
        const { inviteId, token } = request.body;

        if (!inviteId) {
          return response.status(401).json(apiError("invalid-invite"));
        }

        let friendToken: admin.auth.DecodedIdToken | undefined = undefined;
        try {
          friendToken = await auth.verifyIdToken(token);
        } catch {
          return response.status(401).json(apiError("user-not-found"));
        }

        // Get the invite record from the invites collection
        const inviteDoc = await invitesCollection.doc(inviteId).get();

        if (!inviteDoc.exists) {
          return response.status(400).json(
            apiError("invalid-invite") // This link has either expired or has already been used
          );
        }

        const inviteData: FriendInviteData | undefined = inviteDoc.data();

        if (!inviteData) {
          return response.status(401).json(apiError("invalid-invite")); // Could not find the record for this link
        }

        // if the invite type is email, verify that it was meant for provided token
        if (!inviteData.link && inviteData.friend !== friendToken.uid) {
          return response.status(400).json(apiError("friend-mismatch"));
        }

        // Get the sender's schedule - it has to be version 3 (an invite was sent from this user)
        const senderSchedule: Version3ScheduleData | undefined = (
          await schedulesCollection.doc(inviteData.sender).get()
        ).data() as Version3ScheduleData | undefined;

        if (!senderSchedule) {
          return response.status(400).json(apiError("invalid-invite")); // The sender's account has been deleted
        }

        Object.keys(senderSchedule.terms).forEach((t) => {
          Object.keys(senderSchedule.terms[t].versions).forEach((v) => {
            if (!senderSchedule.terms[t].versions[v].friends) {
              senderSchedule.terms[t].versions[v].friends = {};
            }
          });
        });

        // Check if link hasn't expired by calculating the difference between the current time and the time the link was created
        const defaultValidDuration = 7 * 24 * 60 * 60;
        const validDuration = inviteData.validFor ?? defaultValidDuration;
        const diffInSecs =
          (new Date().getTime() - inviteData.created.toDate().getTime()) / 1000;

        if (diffInSecs >= validDuration) {
          // Check if invite link is for a specific friend
          if (inviteData.friend) {
            // Delete the invite from the user's schedule if friend (non-link) invite is expired
            inviteData.versions.forEach(
              (idx) =>
                delete senderSchedule.terms[inviteData.term].versions[idx]
                  .friends[inviteData.friend!]
            );
          }
          // Delete the invite from the invites collection
          await inviteDoc.ref.delete();
          await schedulesCollection.doc(inviteData.sender).set(senderSchedule);
          return response.status(400).json(apiError("invite-expired")); // The invitation link has expired
        }

        // If the link is not expired, update the sender's schedule in the schedules collection and the friend's record in the friends collection
        const friendId = inviteData.link
          ? friendToken?.uid
          : inviteData?.friend;
        if (!friendId) {
          return response.status(400).json(apiError("invalid-invite")); // Invalid friend ID
        }

        if (inviteData.sender === friendId) {
          return response.status(400).json(apiError("accepting-self-schedule"));
        }

        const friendEmail = (await auth.getUser(friendId)).email;
        if (!friendEmail) {
          return response.status(400).json(apiError("friend-not-found"));
        }

        let acceptedAll = true;

        inviteData.versions.forEach((idx) => {
          if (
            !senderSchedule.terms[inviteData.term].versions[idx].friends[
              friendId
            ] ||
            senderSchedule.terms[inviteData.term].versions[idx].friends[
              friendId
            ].status !== "Accepted"
          ) {
            acceptedAll = false;
          }
          senderSchedule.terms[inviteData.term].versions[idx].friends[
            friendId
          ] = {
            email: friendEmail,
            status: "Accepted",
          };
        });

        if (acceptedAll) {
          return response.status(400).json(apiError("already-accepted-all"));
        }

        let friendRecord: FriendData | undefined = (
          await friendsCollection.doc(friendId).get()
        ).data();

        // If the friend record doesn't exist, create it
        if (!friendRecord) {
          friendRecord = { terms: {}, info: {} };
        }
        if (!friendRecord.terms[inviteData.term]) {
          friendRecord.terms[inviteData.term] = { accessibleSchedules: {} };
        }
        const friendArr =
          friendRecord.terms[inviteData.term].accessibleSchedules[
            inviteData.sender
          ] ?? [];
        friendArr.push(
          ...inviteData.versions.filter((v) => !friendArr.includes(v))
        );

        friendRecord.terms[inviteData.term].accessibleSchedules[
          inviteData.sender
        ] = friendArr;

        const senderUserObject = await auth.getUser(inviteData.sender);

        const senderEmail = senderUserObject.email ?? "";
        const senderName = senderUserObject.displayName ?? "";
        if (!(inviteData.sender in friendRecord.info)) {
          friendRecord.info[inviteData.sender] = {
            email: senderEmail,
            name: senderName,
          };
        }

        // Update relevant docs
        await friendsCollection.doc(friendId).set(friendRecord);
        await schedulesCollection.doc(inviteData.sender).set(senderSchedule);
        if (!inviteData.link) {
          await inviteDoc.ref.delete();
        }
        return response.status(202).send({
          email: senderEmail,
          term: inviteData.term,
        });
      } catch (err) {
        console.log(err);
        return response.status(400).json(apiError("unkown-error"));
      }
    });
  });
