import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import type { AcademicActivity } from "@educonnect/shared";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { teacherCanTeach } from "../services/academic";
import { getUserClassIds, isClassMember, loadSchoolClass } from "../services/access";
import { routeParam, serializeData } from "../services/serialize";

export const activitiesRouter = Router();
const activitySchema = z.object({
  classId: z.string().min(1), subject: z.string().trim().min(1).max(100),
  title: z.string().trim().min(4).max(140), description: z.string().trim().min(10).max(3000),
  dueAt: z.string().datetime()
});

activitiesRouter.get("/", allowRoles("student", "teacher", "coordination"), async (req, res, next) => {
  try {
    const snapshot = await db.collection("activities").where("schoolId", "==", req.user!.schoolId).limit(500).get();
    let activities = snapshot.docs.filter((doc) => doc.data().status === "active");
    if (req.user!.role === "teacher") activities = activities.filter((doc) => doc.data().teacherId === req.user!.uid);
    if (req.user!.role === "student") {
      const classIds = new Set(await getUserClassIds(req.user!));
      activities = activities.filter((doc) => classIds.has(String(doc.data().classId)));
    }
    const items = activities.map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<AcademicActivity & { id: string }>;
    if (req.user!.role === "student") {
      const completions = items.length
        ? await db.getAll(...items.map((item) => db.collection("activity_completions").doc(`${item.id}_${req.user!.uid}`)))
        : [];
      const completionByActivity = new Map(completions.filter((doc) => doc.exists).map((doc) => [String(doc.data()?.activityId), doc.data()]));
      const now = Date.now();
      const withStatus = items.map((item) => {
        const completion = completionByActivity.get(item.id);
        return {
          ...item,
          status: completion ? "submitted" : new Date(item.dueAt).getTime() < now ? "overdue" : "pending",
          ...(completion ? { submittedAt: serializeData(completion.submittedAt) } : {})
        };
      });
      withStatus.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
      return res.json({ activities: withStatus });
    }
    items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    res.json({ activities: items });
  } catch (error) { next(error); }
});

activitiesRouter.post("/", allowRoles("teacher"), async (req, res, next) => {
  try {
    const parsed = activitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Revise os dados da atividade." });
    const schoolClass = await loadSchoolClass(parsed.data.classId, req.user!);
    if (!schoolClass || schoolClass.status === "archived") return res.status(404).json({ error: "Turma não encontrada ou arquivada." });
    if (!await teacherCanTeach(req.user!, schoolClass, parsed.data.subject)) return res.status(403).json({ error: "Você não está vinculado a esta turma e disciplina." });
    const now = Timestamp.now();
    const ref = db.collection("activities").doc();
    const data = { ...parsed.data, dueAt: Timestamp.fromDate(new Date(parsed.data.dueAt)), schoolId: req.user!.schoolId, schemaVersion: 1, teacherId: req.user!.uid, teacherName: req.user!.displayName, className: schoolClass.name, status: "active", createdAt: now, updatedAt: now };
    await ref.create(data);
    res.status(201).json({ activity: { id: ref.id, ...serializeData(data) } });
  } catch (error) { next(error); }
});

activitiesRouter.patch("/:activityId", allowRoles("teacher"), async (req, res, next) => {
  try {
    const activityId = routeParam(req.params.activityId);
    const parsed = activitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Revise os dados da atividade." });
    const ref = db.collection("activities").doc(activityId);
    const snapshot = await ref.get();
    const previous = snapshot.data();
    if (!snapshot.exists || previous?.schoolId !== req.user!.schoolId || previous?.teacherId !== req.user!.uid || previous?.status !== "active") return res.status(404).json({ error: "Atividade não encontrada para edição." });
    const schoolClass = await loadSchoolClass(parsed.data.classId, req.user!);
    if (!schoolClass || schoolClass.status === "archived") return res.status(404).json({ error: "Turma não encontrada ou arquivada." });
    if (!await teacherCanTeach(req.user!, schoolClass, parsed.data.subject)) return res.status(403).json({ error: "Você não está vinculado a esta turma e disciplina." });
    await ref.update({ ...parsed.data, dueAt: Timestamp.fromDate(new Date(parsed.data.dueAt)), className: schoolClass.name, updatedAt: Timestamp.now() });
    res.json({ updated: true });
  } catch (error) { next(error); }
});

activitiesRouter.delete("/:activityId", allowRoles("teacher"), async (req, res, next) => {
  try {
    const activityId = routeParam(req.params.activityId);
    const ref = db.collection("activities").doc(activityId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.schoolId !== req.user!.schoolId || snapshot.data()?.teacherId !== req.user!.uid) return res.status(404).json({ error: "Atividade não encontrada." });
    await ref.update({ status: "archived", archivedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    res.json({ archived: true });
  } catch (error) { next(error); }
});

activitiesRouter.post("/:activityId/complete", allowRoles("student"), async (req, res, next) => {
  try {
    const activityId = routeParam(req.params.activityId);
    const ref = db.collection("activities").doc(activityId);
    const activity = await ref.get();
    const data = activity.data();
    if (!activity.exists || data?.schoolId !== req.user!.schoolId || data?.status !== "active") return res.status(404).json({ error: "Atividade não encontrada." });
    if (!await isClassMember(String(data.classId), req.user!, "student")) return res.status(403).json({ error: "Atividade não vinculada à sua turma." });
    const completedAt = Timestamp.now();
    await db.collection("activity_completions").doc(`${activityId}_${req.user!.uid}`).set({ activityId, schoolId: req.user!.schoolId, classId: data.classId, studentId: req.user!.uid, submittedAt: completedAt });
    res.json({ status: "submitted", submittedAt: completedAt.toDate().toISOString() });
  } catch (error) { next(error); }
});
