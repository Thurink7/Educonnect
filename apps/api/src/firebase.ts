import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is required (provide the service account JSON or its Base64-encoded value)");
}

type ServiceAccountEnv = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

const serviceAccountContent = serviceAccountJson.trim();
const decodedServiceAccount = serviceAccountContent.startsWith("{")
  ? serviceAccountContent
  : Buffer.from(serviceAccountContent, "base64").toString("utf8");

let parsedServiceAccount: ServiceAccountEnv;
try {
  parsedServiceAccount = JSON.parse(decodedServiceAccount) as ServiceAccountEnv;
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid service account JSON");
}

if (!parsedServiceAccount.project_id || !parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT must include project_id, client_email, and private_key");
}

const serviceAccount = {
  projectId: parsedServiceAccount.project_id,
  clientEmail: parsedServiceAccount.client_email,
  privateKey: parsedServiceAccount.private_key.replace(/\\n/g, "\n")
};
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.projectId;
const credential = cert({
  projectId: serviceAccount.projectId,
  clientEmail: serviceAccount.clientEmail,
  privateKey: serviceAccount.privateKey
});

const app = getApps()[0] ?? initializeApp({ credential, projectId });
export const auth = getAuth(app);
export const db = getFirestore(app);
