import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { getUserClassIds, loadSchoolClass } from "../services/access";
import { routeParam, serializeData } from "../services/serialize";

export const environmentsRouter = Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(20).max(1000)
});
const scheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
});
const environmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  classId: z.string().min(1),
  schedule: z.array(scheduleSchema).max(70).default([]),
  location: locationSchema
});

environmentsRouter.get("/", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const snapshot = await db.collection("environments").where("schoolId", "==", req.user!.schoolId).limit(500).get();
    const classIds = req.user!.role === "teacher" ? new Set(await getUserClassIds(req.user!)) : null;
    const environments = snapshot.docs
      .filter((doc) => !classIds || classIds.has(String(doc.data().classId)))
      .filter((doc) => !doc.data().archivedAt)
      .map((doc) => ({ id: doc.id, ...serializeData(doc.data()) }));
    res.json({ environments });
  } catch (error) { next(error); }
});

environmentsRouter.post("/", allowRoles("coordination"), async (req, res, next) => {
  try {
    const parsed = environmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Revise nome, turma, horários e localização do ambiente." });
    const linkedClass = await loadSchoolClass(parsed.data.classId, req.user!);
    if (!linkedClass || linkedClass.status === "archived") return res.status(400).json({ error: "Selecione uma turma ativa deste colégio." });
    const now = Timestamp.now();
    const ref = db.collection("environments").doc();
    const data = { ...parsed.data, schoolId: req.user!.schoolId, schemaVersion: 1, createdBy: req.user!.uid, createdAt: now, updatedAt: now };
    await ref.create(data);
    res.status(201).json({ environment: { id: ref.id, ...serializeData(data) } });
  } catch (error) { next(error); }
});

environmentsRouter.patch("/:environmentId", allowRoles("coordination"), async (req, res, next) => {
  try {
    const environmentId = routeParam(req.params.environmentId);
    const parsed = environmentSchema.partial().safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return res.status(400).json({ error: "Informe dados válidos para atualizar o ambiente." });
    const ref = db.collection("environments").doc(environmentId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Ambiente não encontrado." });
    if (parsed.data.classId) {
      const linkedClass = await loadSchoolClass(parsed.data.classId, req.user!);
      if (!linkedClass || linkedClass.status === "archived") return res.status(400).json({ error: "Selecione uma turma ativa deste colégio." });
    }
    await ref.update({ ...parsed.data, updatedAt: Timestamp.now() });
    const updated = await ref.get();
    res.json({ environment: { id: updated.id, ...serializeData(updated.data()!) } });
  } catch (error) { next(error); }
});

environmentsRouter.delete("/:environmentId", allowRoles("coordination"), async (req, res, next) => {
  try {
    const environmentId = routeParam(req.params.environmentId);
    const ref = db.collection("environments").doc(environmentId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Ambiente não encontrado." });
    await ref.delete();
    res.json({ deleted: true });
  } catch (error) { next(error); }
});
