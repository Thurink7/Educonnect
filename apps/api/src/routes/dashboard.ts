import { Timestamp } from "firebase-admin/firestore";
import { Router } from "express";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { getUserClassIds, serializeClass } from "../services/access";
import { serializeData } from "../services/serialize";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const profile = req.user!;
    const since = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (profile.role === "student") {
      const snapshot = await db.collection("attendance").where("studentId", "==", profile.uid).where("recordedAt", ">=", since).get();
      const present = snapshot.docs.filter((doc) => doc.data().status === "present").length;
      const absent = snapshot.docs.filter((doc) => doc.data().status === "absent").length;
      return res.json({ role: profile.role, summary: { present, absent, attendanceRate: present + absent ? Math.round(present / (present + absent) * 1000) / 10 : 100 } });
    }

    const classIds = profile.role === "coordination"
      ? (await (profile.schoolId === "default" ? db.collection("classes").limit(100).get() : db.collection("classes").where("schoolId", "==", profile.schoolId).limit(100).get())).docs.map((doc) => doc.id)
      : await getUserClassIds(profile);
    const classDocs = classIds.length ? await db.getAll(...classIds.map((id) => db.collection("classes").doc(id))) : [];
    const classes = classDocs.filter((doc) => doc.exists && (doc.data()?.schoolId ?? "default") === profile.schoolId).map((doc) => serializeClass(doc.id, doc.data()!));
    const [members, lessons, attendance] = await Promise.all([
      profile.role === "coordination" ? db.collection("class_memberships").where("schoolId", "==", profile.schoolId).get() : Promise.resolve(null),
      db.collection("lessons").where("schoolId", "==", profile.schoolId).where("status", "==", "active").limit(100).get(),
      db.collection("attendance").where("schoolId", "==", profile.schoolId).where("recordedAt", ">=", since).limit(10000).get()
    ]);
    const relevantClassIds = new Set(classes.map((schoolClass) => schoolClass.id));
    const weekRecords = attendance.docs.map((doc) => doc.data()).filter((record) => relevantClassIds.has(String(record.classId)));
    const present = weekRecords.filter((record) => record.status === "present").length;
    const absent = weekRecords.filter((record) => record.status === "absent").length;
    const membersByClass = new Map<string, number>();
    for (const doc of members?.docs ?? []) { const data = doc.data(); if (data.role === "student") membersByClass.set(String(data.classId), (membersByClass.get(String(data.classId)) ?? 0) + 1); }
    const classSummaries = await Promise.all(classes.map(async (schoolClass) => {
      const studentCount = members ? (membersByClass.get(schoolClass.id) ?? schoolClass.studentIds?.length ?? 0) : (await db.collection("class_memberships").where("classId", "==", schoolClass.id).where("role", "==", "student").get()).size || schoolClass.studentIds?.length || 0;
      const records = weekRecords.filter((record) => record.classId === schoolClass.id);
      const activeLesson = lessons.docs.find((lesson) => lesson.data().classId === schoolClass.id) ?? null;
      const p = records.filter((record) => record.status === "present").length;
      const a = records.filter((record) => record.status === "absent").length;
      return { ...schoolClass, studentCount, attendanceRate: p + a ? Math.round(p / (p + a) * 1000) / 10 : 100, activeLesson: activeLesson ? { id: activeLesson.id, ...serializeData(activeLesson.data()) } : null };
    }));
    const teacherIds = new Set((members?.docs ?? []).filter((doc) => doc.data().role === "teacher").map((doc) => String(doc.data().userId)));
    const studentIds = new Set((members?.docs ?? []).filter((doc) => doc.data().role === "student").map((doc) => String(doc.data().userId)));
    res.json({ role: profile.role, summary: { classCount: classes.length, studentCount: profile.role === "coordination" ? studentIds.size : classSummaries.reduce((sum, item) => sum + item.studentCount, 0), teacherCount: teacherIds.size, activeLessons: lessons.size, attendanceRate: present + absent ? Math.round(present / (present + absent) * 1000) / 10 : 100, present, absent, classes: classSummaries } });
  } catch (error) { next(error); }
});

dashboardRouter.get("/monitoring", allowRoles("coordination"), async (req, res, next) => {
  try {
    const active = await db.collection("lessons").where("schoolId", "==", req.user!.schoolId).where("status", "==", "active").orderBy("startsAt", "desc").limit(100).get();
    const classIds = [...new Set(active.docs.map((doc) => String(doc.data().classId)))];
    const classes = classIds.length ? await db.getAll(...classIds.map((id) => db.collection("classes").doc(id))) : [];
    const classNames = new Map(classes.filter((doc) => doc.exists).map((doc) => [doc.id, String(doc.data()?.name ?? "Turma")]));
    const teacherIds = [...new Set(active.docs.map((doc) => String(doc.data().teacherId)))];
    const teachers = teacherIds.length ? await db.getAll(...teacherIds.map((id) => db.collection("users").doc(id))) : [];
    const teacherNames = new Map(teachers.filter((doc) => doc.exists).map((doc) => [doc.id, String(doc.data()?.displayName ?? "Professor")]));
    const sessions = active.docs.map((doc) => ({ id: doc.id, ...serializeData(doc.data()), className: classNames.get(String(doc.data().classId)) ?? "Turma", teacherName: teacherNames.get(String(doc.data().teacherId)) ?? "Professor" }));
    res.json({ sessions });
  } catch (error) { next(error); }
});

dashboardRouter.get("/alerts", allowRoles("coordination"), async (req, res, next) => {
  try {
    const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const attendance = await db.collection("attendance").where("schoolId", "==", req.user!.schoolId).where("recordedAt", ">=", since).limit(10000).get();
    const byStudent = new Map<string, { classId: string; present: number; absent: number }>();
    for (const doc of attendance.docs) {
      const record = doc.data();
      if (record.status !== "present" && record.status !== "absent") continue;
      const current = byStudent.get(String(record.studentId)) ?? { classId: String(record.classId), present: 0, absent: 0 };
      if (record.status === "present") current.present += 1; else current.absent += 1;
      byStudent.set(String(record.studentId), current);
    }
    const atRisk = [...byStudent.entries()].map(([uid, data]) => ({ uid, ...data, rate: data.present + data.absent ? data.present / (data.present + data.absent) * 100 : 100 })).filter((student) => student.present + student.absent >= 5 && student.rate < 75).sort((a, b) => a.rate - b.rate).slice(0, 100);
    const studentDocs = atRisk.length ? await db.getAll(...atRisk.map((item) => db.collection("users").doc(item.uid))) : [];
    const classIds = [...new Set(atRisk.map((item) => item.classId))];
    const classDocs = classIds.length ? await db.getAll(...classIds.map((id) => db.collection("classes").doc(id))) : [];
    const names = new Map(studentDocs.filter((doc) => doc.exists && doc.data()?.schoolId === req.user!.schoolId).map((doc) => [doc.id, String(doc.data()?.displayName ?? "Estudante")]));
    const classNames = new Map(classDocs.filter((doc) => doc.exists).map((doc) => [doc.id, String(doc.data()?.name ?? "Turma")]));
    res.json({ alerts: atRisk.filter((item) => names.has(item.uid)).map((item) => ({ studentId: item.uid, studentName: names.get(item.uid), classId: item.classId, className: classNames.get(item.classId), attendanceRate: Math.round(item.rate * 10) / 10, absences: item.absent, present: item.present })) });
  } catch (error) { next(error); }
});
