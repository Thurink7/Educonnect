import { Timestamp } from "firebase-admin/firestore";
import { Router } from "express";
import { z } from "zod";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { loadSchoolClass, requireClassAccess } from "../services/access";
import { routeParam, serializeData } from "../services/serialize";

export const protocolsRouter = Router();
const protocolBody = z.object({ classId: z.string().min(1), studentId: z.string().min(1), title: z.string().trim().min(4).max(120), description: z.string().trim().min(10).max(2000), dueAt: z.string().datetime().optional() });

protocolsRouter.get("/", async (req, res, next) => {
  try {
    const profile = req.user!;
    let snapshot;
    if (profile.role === "student") snapshot = await db.collection("protocols").where("studentId", "==", profile.uid).where("schoolId", "==", profile.schoolId).orderBy("createdAt", "desc").limit(100).get();
    else if (profile.role === "coordination") snapshot = await db.collection("protocols").where("schoolId", "==", profile.schoolId).orderBy("createdAt", "desc").limit(300).get();
    else return res.status(403).json({ error: "Somente a coordenação e o estudante podem consultar protocolos." });
    res.json({ protocols: snapshot.docs.map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) });
  } catch (error) { next(error); }
});

protocolsRouter.post("/", allowRoles("coordination"), async (req, res, next) => {
  try {
    const parsed = protocolBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Preencha turma, estudante, título e descrição do protocolo." });
    const { classId, studentId, title, description, dueAt } = parsed.data;
    const schoolClass = await loadSchoolClass(classId, req.user!);
    if (!schoolClass) return res.status(404).json({ error: "Turma não encontrada." });
    const [member, student] = await Promise.all([db.collection("class_memberships").doc(`${classId}_${studentId}`).get(), db.collection("users").doc(studentId).get()]);
    if ((!member.exists || member.data()?.role !== "student") && !schoolClass.studentIds?.includes(studentId)) return res.status(404).json({ error: "Estudante não está vinculado à turma." });
    if (!student.exists || student.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Estudante não encontrado neste colégio." });
    const now = Timestamp.now();
    const ref = db.collection("protocols").doc();
    const data = { schoolId: req.user!.schoolId, schemaVersion: 1, classId, studentId, studentName: student.data()?.displayName ?? "Estudante", className: schoolClass.name, title, description, dueAt: dueAt ? Timestamp.fromDate(new Date(dueAt)) : null, status: "open", createdBy: req.user!.uid, createdAt: now, updatedAt: now };
    await ref.set(data);
    res.status(201).json({ protocol: { id: ref.id, ...serializeData(data) } });
  } catch (error) { next(error); }
});

protocolsRouter.patch("/:protocolId/resolve", allowRoles("student"), async (req, res, next) => {
  try {
    const protocolId = routeParam(req.params.protocolId);
    const ref = db.collection("protocols").doc(protocolId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.schoolId !== req.user!.schoolId || snapshot.data()?.studentId !== req.user!.uid) return res.status(404).json({ error: "Protocolo não encontrado." });
    if (snapshot.data()?.status === "resolved") return res.json({ status: "resolved" });
    await ref.update({ status: "resolved", resolvedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    res.json({ status: "resolved" });
  } catch (error) { next(error); }
});
