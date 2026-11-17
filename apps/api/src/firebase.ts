import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT is required");

type ServiceAccountEnv = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

let serviceAccount: ServiceAccountEnv;
try {
  serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccountEnv;
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid service account JSON");
}

if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT must include project_id, client_email, and private_key");
}

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id;
const credential = cert({
  projectId: serviceAccount.project_id,
  clientEmail: serviceAccount.client_email,
  privateKey: serviceAccount.private_key.replace(/\\n/g, "\n")
});

const app = getApps()[0] ?? initializeApp({ credential, projectId });
export const auth = getAuth(app);
export const db = getFirestore(app);
