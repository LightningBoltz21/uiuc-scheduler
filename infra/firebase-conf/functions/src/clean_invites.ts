import admin from "./firebase";
import {
  AnyScheduleData,
  FriendInviteData,
  Version3ScheduleData,
} from "../utils/types";
import * as functions from "firebase-functions";

const firestore = admin.firestore();
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

/*
This function is called every week to clean up the friend-invites collection. We only want to keep the invites made in the past week.
*/

export const cleanInvites = functions
  .region("us-east1")
  .pubsub.schedule("every 1 week")
  .onRun(async () => {
    const docs = await invitesCollection.get();
    docs.forEach(async (doc) => {
      const data = await doc.data();
      if (!data) {
        doc.ref.delete();
        return;
      }
      const defaultValidDuration = 7 * 24 * 60 * 60;
      const validDuration = data?.validFor ?? defaultValidDuration;
      const diffInSecs =
        (new Date().getTime() - data.created.toDate().getTime()) / 1000;
      if (diffInSecs >= validDuration) {
        const senderDoc = await schedulesCollection.doc(data.sender).get();
        const senderData = (await senderDoc.data()) as
          | Version3ScheduleData
          | undefined;
        if (!senderData) {
          doc.ref.delete();
          return;
        }

        if (data.friend) {
          data.versions.forEach(
            (idx) =>
              delete senderData.terms[data.term].versions[idx].friends[
                data.friend!
              ]
          );
        }

        await senderDoc.ref.set(senderData);
        await doc.ref.delete();
      }
    });
  });
