import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  FriendData,
  FriendInviteData,
  AnyScheduleData,
  Version3ScheduleData,
  ScheduleDeletionRequest,
} from "../utils/types";

const firestore = admin.firestore();
const auth = admin.auth();

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

export const deleteSharedSchedule = functions
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

        const {
          IDToken,
          peerUserId,
          term,
          versions,
          owner,
        }: ScheduleDeletionRequest = request.body;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!peerUserId || !term || !versions) {
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

        // Get user UID from the decoded token
        const requesterId = decodedToken.uid;

        const senderId = owner ? requesterId : peerUserId;
        const friendId = owner ? peerUserId : requesterId;

        // find and delete existing invites for the same sender, friend, term, and version
        // also deletes friend invites that show up on the sender's invitation modal
        try {
          await firestore.runTransaction(async (transaction) => {
            // Fetch invite documents
            const existingInvitesQuery = await invitesCollection
              .where("sender", "==", senderId)
              .where("friend", "==", friendId)
              .where("term", "==", term)
              .where("versions", "array-contains-any", versions);
            const existingInvites = await transaction.get(existingInvitesQuery);

            // Fetch schedule document
            const scheduleData: Version3ScheduleData | undefined = (
              await transaction.get(schedulesCollection.doc(senderId))
            ).data() as Version3ScheduleData | undefined;

            // Fetch friend document and accessible schedules
            const friendData = (
              await transaction.get(friendsCollection.doc(friendId))
            ).data();

            const accessibleSchedules =
              friendData?.terms?.[term]?.accessibleSchedules;

            let errorCode = 0;

            for (const doc of existingInvites.docs) {
              // Do not delete link-type invitations
              if (doc.get("link")) {
                continue;
              }

              // Verify requester ID
              if (
                (owner && doc.get("sender") !== requesterId) ||
                (!owner && doc.get("friendId") !== requesterId)
              ) {
                errorCode = 1;
                break;
              }

              const currVersions: string[] = doc.get("versions");
              const newVersions = currVersions.filter(
                (v) => !versions.includes(v)
              );
              if (newVersions.length === 0) {
                transaction.delete(doc.ref);
              } else {
                // Update versions list if entries were deleted or changed but list is not empty
                transaction.update(doc.ref, { versions: newVersions });
              }
            }

            versions.forEach((version) => {
              delete scheduleData?.terms[term]?.versions[version]?.friends?.[
                friendId
              ];
            });

            if (accessibleSchedules?.[senderId]) {
              accessibleSchedules[senderId] = accessibleSchedules[
                senderId
              ].filter((v) => !versions.includes(v));
              if (accessibleSchedules[senderId].length === 0) {
                delete accessibleSchedules[senderId];
              }
            }

            if (scheduleData) {
              await transaction.set(
                schedulesCollection.doc(senderId),
                scheduleData
              );
            }

            if (friendData) {
              await transaction.set(
                friendsCollection.doc(friendId),
                friendData
              );
            }

            if (errorCode) {
              let errorMsg = "";
              switch (errorCode) {
                case 1:
                  errorMsg =
                    "Unathorized deletion request - user token does not match invitation creator/recipient";
              }
              throw new Error(errorMsg);
            }
          });
        } catch (err) {
          return response
            .status(401)
            .json(
              apiError(`Database call failed to delete version(s) - ${err}`)
            );
        }
        return response.status(200).json({ message: "Deleted successfully" });
      } catch (err) {
        return response
          .status(400)
          .json(apiError("Error deleting shared schedule"));
      }
    });
  });
