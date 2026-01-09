import * as functions from "firebase-functions";
import * as firestore from "@google-cloud/firestore";

const firestoreClient = new firestore.v1.FirestoreAdminClient();

// Add collection IDs here to include them in backups.
// Leave empty to export all collections.
const backedUpCollections = ["schedules"];
const bucket = "gs://gt-scheduler-web-prod-firestore-backup";

/**
 * This function backs up all of the user data collections in Firestore,
 * and runs once a day.
 * It writes the backups to a Cloud Storage bucket
 * that is set to retain the backups for 180 days before they are deleted.
 * Based off of the following article:
 * https://medium.com/@bastihumann/how-to-backup-firestore-the-firebase-way-874da6d75082
 */
export const backupFirestore = functions
  .region("us-east1")
  .pubsub.schedule("every day 00:00")
  .onRun(async () => {
    const projectId = process.env.GCP_PROJECT ?? process.env.GCLOUD_PROJECT;
    if (projectId == null) {
      throw new Error("Could not obtain project ID from environment");
    }

    const timestamp = new Date().toISOString();
    const databaseName = firestoreClient.databasePath(projectId, "(default)");

    functions.logger.info("Starting to backup project", {
      project_id: projectId,
      collections: backedUpCollections,
    });

    const response = await firestoreClient.exportDocuments({
      name: databaseName,
      outputUriPrefix: `${bucket}/backups/${timestamp}`,
      collectionIds: backedUpCollections,
    });

    functions.logger.info("Export operation started", {
      name: response[0].name,
    });
  });
