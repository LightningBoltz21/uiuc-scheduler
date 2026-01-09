import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  AnyScheduleData,
  CreateInviteRequestData,
  FriendInviteData,
  Version3ScheduleData,
} from "../utils/types";

const firestore = admin.firestore();
const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;
const auth = admin.auth();

const corsHandler = cors({ origin: true });

/* This endpoint is called when a user wants to send an invitation*/
export const createFriendInvitationLink = functions
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
        const { IDToken, term, versions, redirectURL, validFor } =
          request.body as CreateInviteRequestData;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!term || !versions || !redirectURL || !validFor) {
          return response
            .status(400)
            .json(apiError("Invalid arguments provided"));
        }

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        const senderEmail = decodedToken.email;

        if (!senderEmail) {
          return response
            .status(400)
            .json(apiError("Cannot share schedule link without an email"));
        }

        // Get Sender UID from the decoded token
        const senderId = decodedToken.uid;

        // Get Sender record from the schedules collection - it has to be version 3 because an invite was sent from it
        const senderRes = await schedulesCollection.doc(senderId).get();
        const senderData: Version3ScheduleData | undefined =
          senderRes.data() as Version3ScheduleData | undefined;

        if (
          !senderData ||
          !senderData?.terms ||
          !senderData.terms[term]?.versions ||
          versions.filter((v) => !senderData.terms[term].versions[v]).length > 0
        ) {
          return response
            .status(400)
            .json(apiError("Cannot make link for invalid schedule version"));
        }

        const sortedVersions = versions.sort();

        // find and delete existing links for the same sender, term, and version
        const existingInvites = await invitesCollection
          .where("sender", "==", senderId)
          .where("term", "==", term)
          .where("versions", "==", sortedVersions)
          .where("link", "==", true)
          .where("validFor", "==", validFor)
          .get();
        const batch = firestore.batch();
        existingInvites.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();

        // create new invite record in db
        const record: FriendInviteData = {
          sender: senderId,
          term,
          versions: sortedVersions,
          created: admin.firestore.Timestamp.fromDate(new Date()),
          link: true,
          validFor,
        };
        let inviteId;
        try {
          // Add the invite data to the schedule of the sender
          const addRes = await invitesCollection.add(record);
          inviteId = addRes.id;
        } catch {
          return response
            .status(400)
            .json(apiError("Error saving new invite record"));
        }
        return response
          .status(200)
          .json({ link: redirectURL + `#/invite/${inviteId}` });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  });
