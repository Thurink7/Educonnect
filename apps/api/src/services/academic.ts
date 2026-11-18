import type { SchoolClass, UserProfile } from "@educonnect/shared";
import { db } from "../firebase";
import { isClassMember } from "./access";

export async function loadClassStudents(classId: string, schoolClass: SchoolClass, schoolId: string) {
  const members = await db.collection("class_memberships").where("classId", "==", classId).where("role", "==", "student").get();
  const ids = members.docs.filter((doc) => (doc.data().schoolId ?? "default") === schoolId).map((doc) => String(doc.data().userId));
  const studentIds = ids.length ? ids : schoolClass.studentIds ?? [];
  const users = studentIds.length ? await db.getAll(...studentIds.map((id) => db.collection("users").doc(id))) : [];
  return users.filter((doc) => doc.exists && (doc.data()?.schoolId ?? "default") === schoolId && doc.data()?.role === "student")
    .map((doc) => ({ studentId: doc.id, studentName: String(doc.data()?.displayName ?? "Estudante"), registration: doc.data()?.registration ? String(doc.data()?.registration) : undefined }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "pt-BR"));
}

export async function teacherCanTeach(profile: UserProfile, schoolClass: SchoolClass, subject: string) {
  if (profile.role !== "teacher" || !schoolClass.subjects.includes(subject)) return false;
  const assignment = profile.teachingAssignments?.find((item) => item.classId === schoolClass.id);
  if (assignment) return assignment.subjects.includes(subject);
  return isClassMember(schoolClass.id, profile, "teacher");
}
