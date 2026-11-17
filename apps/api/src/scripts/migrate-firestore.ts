import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
import { db } from "../firebase";

const apply = process.argv.includes("--apply");
const now = Timestamp.now();
const pending: Array<{ ref: DocumentReference; data: DocumentData }> = [];
const isoToTimestamp = (value: unknown) => {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string") { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : Timestamp.fromDate(date); }
  return value;
};

async function main() {
  const [classes, users, lessons, attendance, protocols] = await Promise.all([
    db.collection("classes").get(), db.collection("users").get(), db.collection("lessons").get(), db.collection("attendance").get(), db.collection("protocols").get()
  ]);
  const usersById = new Map(users.docs.map((doc) => [doc.id, doc.data()]));
  const classSchoolById = new Map(classes.docs.map((doc) => [doc.id, doc.data().schoolId ?? "default"]));
  const memberPairs = new Map<string, { classId: string; userId: string; schoolId: string; role: "teacher" | "student" }>();
  const userClasses = new Map<string, Set<string>>();
  const addMember = (classId: string, userId: string, role: "teacher" | "student") => {
    const schoolId = classSchoolById.get(classId);
    const profile = usersById.get(userId);
    if (!schoolId || !profile || profile.role !== role || (profile.schoolId && profile.schoolId !== schoolId)) return;
    memberPairs.set(`${classId}_${userId}`, { classId, userId, schoolId, role });
  };
  for (const doc of classes.docs) {
    const data = doc.data();
    for (const userId of Array.isArray(data.teacherIds) ? data.teacherIds : []) if (typeof userId === "string") addMember(doc.id, userId, "teacher");
    for (const userId of Array.isArray(data.studentIds) ? data.studentIds : []) if (typeof userId === "string") addMember(doc.id, userId, "student");
  }
  for (const doc of users.docs) {
    const data = doc.data();
    if (data.role !== "teacher" && data.role !== "student") continue;
    for (const classId of Array.isArray(data.classIds) ? data.classIds : []) if (typeof classId === "string") addMember(classId, doc.id, data.role);
  }
  for (const doc of classes.docs) pending.push({ ref: doc.ref, data: { schoolId: classSchoolById.get(doc.id), schemaVersion: 1, updatedAt: doc.data().updatedAt ?? now } });
  for (const [id, membership] of memberPairs) {
    const ref = db.collection("class_memberships").doc(id);
    pending.push({ ref, data: { ...membership, schemaVersion: 1, createdAt: now, migratedAt: now } });
    const ids = userClasses.get(membership.userId) ?? new Set<string>();
    ids.add(membership.classId);
    userClasses.set(membership.userId, ids);
  }
  for (const doc of users.docs) {
    const profile = doc.data();
    const classIds = new Set<string>(Array.isArray(profile.classIds) ? profile.classIds.filter((value: unknown): value is string => typeof value === "string") : []);
    for (const id of userClasses.get(doc.id) ?? []) classIds.add(id);
    const inferredSchool = [...(userClasses.get(doc.id) ?? [])].map((id) => classSchoolById.get(id)).find(Boolean);
    pending.push({ ref: doc.ref, data: { schoolId: profile.schoolId ?? inferredSchool ?? "default", classIds: [...classIds], schemaVersion: 1 } });
  }
  for (const doc of lessons.docs) {
    const data = doc.data();
    const schoolId = data.schoolId ?? classSchoolById.get(String(data.classId)) ?? "default";
    pending.push({ ref: doc.ref, data: { schoolId, schemaVersion: 1, startsAt: isoToTimestamp(data.startsAt), ...(data.endsAt ? { endsAt: isoToTimestamp(data.endsAt) } : {}), ...(data.qrExpiresAt ? { qrExpiresAt: isoToTimestamp(data.qrExpiresAt) } : {}), updatedAt: isoToTimestamp(data.updatedAt) ?? now } });
  }
  for (const doc of attendance.docs) {
    const data = doc.data();
    const schoolId = data.schoolId ?? classSchoolById.get(String(data.classId)) ?? "default";
    pending.push({ ref: doc.ref, data: { schoolId, schemaVersion: 1, recordedAt: isoToTimestamp(data.recordedAt) ?? now, ...(data.updatedAt ? { updatedAt: isoToTimestamp(data.updatedAt) } : {}) } });
  }
  for (const doc of protocols.docs) {
    const data = doc.data();
    const schoolId = data.schoolId ?? usersById.get(String(data.studentId))?.schoolId ?? "default";
    pending.push({ ref: doc.ref, data: { schoolId, schemaVersion: 1, createdAt: isoToTimestamp(data.createdAt) ?? now, updatedAt: isoToTimestamp(data.updatedAt) ?? now, ...(data.dueAt ? { dueAt: isoToTimestamp(data.dueAt) } : {}) } });
  }

  console.info(JSON.stringify({ mode: apply ? "apply" : "dry-run", classes: classes.size, users: users.size, memberships: memberPairs.size, lessons: lessons.size, attendance: attendance.size, protocols: protocols.size, writes: pending.length }, null, 2));
  if (!apply) { console.info("Prévia concluída; nenhum documento foi alterado. Use --apply somente após revisar o modelo e a prévia."); return; }
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = db.batch();
    for (const write of pending.slice(offset, offset + 400)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
  console.info("Migração concluída.");
}

main().catch((error) => { console.error("Migração não concluída.", error); process.exitCode = 1; });
