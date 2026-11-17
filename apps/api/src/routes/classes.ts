import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Router } from "express";
import { z } from "zod";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { getUserClassIds, loadSchoolClass, requireClassAccess, serializeClass } from "../services/access";
import { routeParam, serializeData } from "../services/serialize";

export const classesRouter = Router();

classesRouter.get("/", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const profile = req.user!;
    const snapshot = profile.role === "coordination"
      ? (profile.schoolId === "default" ? await db.collection("classes").get() : await db.collection("classes").where("schoolId", "==", profile.schoolId).get())
      : await (async () => {
          const ids = await getUserClassIds(profile);
          if (!ids.length) return null;
          const refs = ids.slice(0, 100).map((id) => db.collection("classes").doc(id));
          return { docs: await db.getAll(...refs) };
        })();
    const classes = (snapshot?.docs ?? []).filter((doc) => doc.exists && (doc.data()?.schoolId ?? "default") === profile.schoolId).map((doc) => serializeClass(doc.id, doc.data()!));
    res.json({ classes });
  } catch (error) { next(error); }
});

const locationSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().min(20).max(1000) });
const scheduleSchema = z.object({ weekday: z.number().int().min(0).max(6), startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), subject: z.string().min(1).max(100), teacherId: z.string().optional() });
const createClassSchema = z.object({ name: z.string().trim().min(2).max(100), shift: z.string().trim().min(1).max(40), subjects: z.array(z.string().trim().min(1).max(100)).min(1).max(20), location: locationSchema, schedule: z.array(scheduleSchema).max(100).default([]) });

classesRouter.post("/", allowRoles("coordination"), async (req, res, next) => {
  try {
    const parsed = createClassSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Revise o nome, turno e disciplinas da turma." });
    const now = Timestamp.now();
    const ref = db.collection("classes").doc();
    const data = { ...parsed.data, schoolId: req.user!.schoolId, schemaVersion: 1, createdBy: req.user!.uid, createdAt: now, updatedAt: now };
    await ref.set(data);
    res.status(201).json({ schoolClass: serializeClass(ref.id, data) });
  } catch (error) { next(error); }
});

const addMemberSchema = z.object({ userId: z.string().min(1), role: z.enum(["teacher", "student"]) });
classesRouter.post("/:classId/members", allowRoles("coordination"), async (req, res, next) => {
  try {
    const classId = routeParam(req.params.classId);
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Informe o identificador e o perfil do usuário." });
    const { userId, role } = parsed.data;
    const schoolClass = await loadSchoolClass(classId, req.user!);
    if (!schoolClass) return res.status(404).json({ error: "Turma não encontrada." });
    const userRef = db.collection("users").doc(userId);
    const membershipRef = db.collection("class_memberships").doc(`${classId}_${userId}`);
    const [userDoc, existing] = await Promise.all([userRef.get(), membershipRef.get()]);
    if (!userDoc.exists || userDoc.data()?.schoolId !== req.user!.schoolId || userDoc.data()?.role !== role) return res.status(404).json({ error: "Usuário não encontrado neste colégio com o perfil selecionado." });
    if (existing.exists) return res.status(409).json({ error: "Este usuário já está vinculado à turma." });
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(membershipRef, { classId, schoolId: req.user!.schoolId, schemaVersion: 1, userId, role, createdAt: now, createdBy: req.user!.uid });
    batch.update(userRef, { classIds: FieldValue.arrayUnion(classId), updatedAt: now });
    await batch.commit();
    res.status(201).json({ membership: { id: membershipRef.id, classId, schoolId: req.user!.schoolId, userId, role, createdAt: now.toDate().toISOString() } });
  } catch (error) { next(error); }
});

classesRouter.get("/:classId/roster", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const classId = routeParam(req.params.classId);
    const { schoolClass, allowed } = await requireClassAccess(classId, req.user!);
    if (!schoolClass) return res.status(404).json({ error: "Turma não encontrada." });
    if (!allowed) return res.status(403).json({ error: "Você não tem acesso a esta turma." });
    const snapshot = await db.collection("class_memberships").where("classId", "==", classId).where("role", "==", "student").get();
    const uids = snapshot.docs.length ? snapshot.docs.map((doc) => doc.data().userId as string) : schoolClass.studentIds ?? [];
    const users = uids.length ? await db.getAll(...uids.map((uid) => db.collection("users").doc(uid))) : [];
    const roster = users.filter((doc) => doc.exists).map((doc) => ({ uid: doc.id, displayName: doc.data()?.displayName ?? "Estudante", registration: doc.data()?.registration, email: req.user!.role === "coordination" || req.user!.role === "teacher" ? doc.data()?.email : undefined })).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    res.json({ roster });
  } catch (error) { next(error); }
});

classesRouter.get("/:classId/overview", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const classId = routeParam(req.params.classId);
    const { schoolClass, allowed } = await requireClassAccess(classId, req.user!);
    if (!schoolClass) return res.status(404).json({ error: "Turma não encontrada." });
    if (!allowed) return res.status(403).json({ error: "Você não tem acesso a esta turma." });
    const since = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const [membersSnapshot, lessonsSnapshot, attendanceSnapshot] = await Promise.all([
      db.collection("class_memberships").where("classId", "==", classId).where("role", "==", "student").get(),
      db.collection("lessons").where("classId", "==", classId).where("startsAt", ">=", since).orderBy("startsAt", "desc").limit(100).get(),
      db.collection("attendance").where("classId", "==", classId).where("recordedAt", ">=", since).orderBy("recordedAt", "desc").limit(5000).get()
    ]);
    const memberIds = membersSnapshot.docs.length ? membersSnapshot.docs.map((doc) => doc.data().userId as string) : schoolClass.studentIds ?? [];
    const userDocs = memberIds.length ? await db.getAll(...memberIds.map((uid) => db.collection("users").doc(uid))) : [];
    const userById = new Map(userDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()!]));
    const records = attendanceSnapshot.docs.map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<{ id: string; lessonId: string; studentId: string; classId: string; status: string; recordedAt: string }>;
    const recordById = new Map(records.map((record) => [`${record.lessonId}_${record.studentId}`, record]));
    const lessons = lessonsSnapshot.docs.map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<{ id: string; startsAt: string; status: string; [key: string]: unknown }>;
    const rates = new Map<string, { present: number; counted: number; absences: number }>();
    for (const record of records) {
      const state = rates.get(record.studentId) ?? { present: 0, counted: 0, absences: 0 };
      if (record.status === "present") { state.present += 1; state.counted += 1; }
      if (record.status === "absent") { state.counted += 1; state.absences += 1; }
      rates.set(record.studentId, state);
    }
    const roster = memberIds.map((uid) => {
      const user = userById.get(uid) ?? {};
      const rate = rates.get(uid) ?? { present: 0, counted: 0, absences: 0 };
      return { uid, displayName: user.displayName ?? "Estudante", registration: user.registration, attendanceRate: rate.counted ? Math.round(rate.present / rate.counted * 1000) / 10 : 100, absenceCount: rate.absences };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    const active = lessons.find((lesson) => lesson.status === "active") ?? null;
    const fortalezaDay = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayLessons = lessons.filter((lesson) => new Date(new Date(String(lesson.startsAt)).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) === fortalezaDay);
    const todayLessonIds = new Set(todayLessons.map((lesson) => lesson.id));
    const todayRecords = records.filter((record) => todayLessonIds.has(record.lessonId));
    const presentToday = new Set(todayRecords.filter((record) => record.status === "present").map((record) => record.studentId)).size;
    const absentToday = new Set(todayRecords.filter((record) => record.status === "absent").map((record) => record.studentId)).size;
    const allPresent = records.filter((record) => record.status === "present").length;
    const counted = records.filter((record) => record.status === "present" || record.status === "absent").length;
    const completeRoster = roster.map((student) => ({ ...student, attendance: active ? recordById.get(`${active.id}_${student.uid}`) : undefined }));
    const { location: _privateRoomCoordinates, ...visibleClass } = schoolClass;
    res.json({ overview: { schoolClass: visibleClass, roster: completeRoster, activeLesson: active, lessons, attendanceRate: counted ? Math.round(allPresent / counted * 1000) / 10 : 100, presentToday, absentToday } });
  } catch (error) { next(error); }
});

classesRouter.patch("/:classId", allowRoles("coordination"), async (req, res, next) => {
  try {
    const classId = routeParam(req.params.classId);
    const parsed = createClassSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Os dados da turma são inválidos." });
    const schoolClass = await loadSchoolClass(classId, req.user!);
    if (!schoolClass) return res.status(404).json({ error: "Turma não encontrada." });
    await db.collection("classes").doc(classId).update({ ...parsed.data, updatedAt: Timestamp.now() });
    const updated = await loadSchoolClass(classId, req.user!);
    res.json({ schoolClass: updated ? serializeClass(updated.id, updated as unknown as Record<string, unknown>) : null });
  } catch (error) { next(error); }
});
