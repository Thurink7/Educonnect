import type { DocumentData } from "firebase-admin/firestore";
import type { MemberRole, SchoolClass, UserProfile } from "@educonnect/shared";
import { db } from "../firebase";
import { iso } from "./serialize";

export async function loadSchoolClass(classId: string, profile: UserProfile) {
  const snapshot = await db.collection("classes").doc(classId).get();
  if (!snapshot.exists || (snapshot.data()?.schoolId ?? "default") !== profile.schoolId) return null;
  return { id: snapshot.id, ...snapshot.data(), schoolId: profile.schoolId } as SchoolClass;
}

export async function isClassMember(classId: string, profile: UserProfile, role?: MemberRole) {
  if ((!role || role === "teacher") && profile.role === "teacher" && profile.teachingAssignments?.some((item) => item.classId === classId)) return true;
  const membership = await db.collection("class_memberships").doc(`${classId}_${profile.uid}`).get();
  if (membership.exists) return !role || membership.data()?.role === role;
  if (profile.classIds?.includes(classId)) return !role || role === profile.role;
  const classSnapshot = await db.collection("classes").doc(classId).get();
  if (!classSnapshot.exists) return false;
  const legacyIds: string[] = role === "teacher"
    ? classSnapshot.data()?.teacherIds ?? []
    : role === "student" ? classSnapshot.data()?.studentIds ?? [] : [];
  return legacyIds.includes(profile.uid);
}

export async function requireClassAccess(classId: string, profile: UserProfile) {
  const schoolClass = await loadSchoolClass(classId, profile);
  if (!schoolClass) return { schoolClass: null, allowed: false };
  if (profile.role === "coordination") return { schoolClass, allowed: true };
  return { schoolClass, allowed: await isClassMember(classId, profile, profile.role) };
}

export async function getUserClassIds(profile: UserProfile) {
  const memberships = await db.collection("class_memberships").where("userId", "==", profile.uid).get();
  const ids = new Set(memberships.docs.filter((doc) => doc.data().schoolId === profile.schoolId).map((doc) => String(doc.data().classId)));
  for (const id of profile.classIds ?? []) ids.add(id);
  for (const assignment of profile.teachingAssignments ?? []) ids.add(assignment.classId);
  return [...ids];
}

export function serializeClass(id: string, data: DocumentData): SchoolClass {
  const { teacherIds: _legacyTeachers, studentIds: _legacyStudents, location: _privateRoomCoordinates, ...fields } = data;
  return { id, ...fields, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt) } as SchoolClass;
}
