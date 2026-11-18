import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { isClassMember, loadSchoolClass, requireClassAccess } from "../services/access";
import { HttpError } from "../services/http-error";
import { createAttendanceToken } from "../services/qr";
import { routeParam, serializeData } from "../services/serialize";

export const lessonsRouter = Router();
const lessonBody = z.object({ classId: z.string().min(1), subject: z.string().trim().min(1).max(100), mode: z.enum(["in-person", "remote"]).default("in-person"), startsAt: z.string().datetime().optional(), locationMode: z.enum(["current", "environment"]), environmentId: z.string().optional(), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().min(20).max(1000) }).optional() });

function renderLesson(id: string, data: DocumentData) {
  return { id, ...serializeData(data) };
}

lessonsRouter.post("/", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const parsed = lessonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Informe turma e disciplina para iniciar a aula." });
    const { classId, subject, mode } = parsed.data;
    if (mode === "remote") return res.status(400).json({ error: "A chamada por QR está disponível para aulas presenciais. Para aulas remotas, use a chamada manual." });
    const schoolClass = await loadSchoolClass(classId, req.user!);
    if (!schoolClass || schoolClass.status === "archived") return res.status(404).json({ error: "Turma não encontrada ou arquivada neste colégio." });
    if (req.user!.role === "teacher" && !await isClassMember(classId, req.user!, "teacher")) return res.status(403).json({ error: "Turma não vinculada a este professor." });
    if (!schoolClass.subjects.includes(subject)) return res.status(400).json({ error: "A disciplina não está cadastrada nesta turma." });
    let lessonLocation = parsed.data.location;
    if (parsed.data.locationMode === "environment") {
      if (!parsed.data.environmentId) return res.status(400).json({ error: "Selecione um ambiente para usar sua localização predefinida." });
      const environment = await db.collection("environments").doc(parsed.data.environmentId).get();
      const environmentData = environment.data();
      if (!environment.exists || environmentData?.archivedAt || environmentData?.schoolId !== req.user!.schoolId || environmentData?.classId !== classId) return res.status(400).json({ error: "O ambiente selecionado não está ativo nesta turma." });
      lessonLocation = environmentData.location;
    }
    if (!lessonLocation) return res.status(400).json({ error: "Obtenha sua localização atual ou selecione um ambiente cadastrado para esta turma." });
    const existing = await db.collection("lessons").where("classId", "==", classId).where("status", "==", "active").limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: "Esta turma já possui uma aula em andamento.", lessonId: existing.docs[0].id });
    const ref = db.collection("lessons").doc();
    const { token, payload } = createAttendanceToken(ref.id, classId, req.user!.schoolId);
    const now = Timestamp.now();
    const data = { schoolId: req.user!.schoolId, schemaVersion: 1, classId, subject, mode, location: lessonLocation, locationMode: parsed.data.locationMode, ...(parsed.data.environmentId ? { environmentId: parsed.data.environmentId } : {}), teacherId: req.user!.uid, startsAt: parsed.data.startsAt ? Timestamp.fromDate(new Date(parsed.data.startsAt)) : now, status: "active", qrNonce: payload.nonce, qrExpiresAt: Timestamp.fromMillis(payload.expiresAt), presentCount: 0, createdAt: now, updatedAt: now };
    await ref.set(data);
    const qrDataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: "M", margin: 2, width: 280 });
    res.status(201).json({ lesson: renderLesson(ref.id, data), qrDataUrl, expiresAt: new Date(payload.expiresAt).toISOString() });
  } catch (error) { next(error); }
});

lessonsRouter.post("/:lessonId/qr", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const lessonId = routeParam(req.params.lessonId);
    const ref = db.collection("lessons").doc(lessonId);
    const lesson = await ref.get();
    if (!lesson.exists || lesson.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Aula não encontrada." });
    const data = lesson.data()!;
    if (data.status !== "active") return res.status(409).json({ error: "A aula já foi encerrada." });
    if (req.user!.role === "teacher" && data.teacherId !== req.user!.uid) return res.status(403).json({ error: "Somente o professor responsável pode renovar este QR Code." });
    const { token, payload } = createAttendanceToken(ref.id, data.classId, data.schoolId);
    await ref.update({ qrNonce: payload.nonce, qrExpiresAt: Timestamp.fromMillis(payload.expiresAt), updatedAt: Timestamp.now() });
    const qrDataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: "M", margin: 2, width: 280 });
    res.json({ qrDataUrl, expiresAt: new Date(payload.expiresAt).toISOString() });
  } catch (error) { next(error); }
});

lessonsRouter.get("/:lessonId/roster", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const lessonId = routeParam(req.params.lessonId);
    const lesson = await db.collection("lessons").doc(lessonId).get();
    if (!lesson.exists || lesson.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Aula não encontrada." });
    const data = lesson.data()!;
    const access = await requireClassAccess(data.classId, req.user!);
    if (!access.allowed) return res.status(403).json({ error: "Você não tem acesso a esta turma." });
    const [members, attendance] = await Promise.all([
      db.collection("class_memberships").where("classId", "==", data.classId).where("role", "==", "student").get(),
      db.collection("attendance").where("lessonId", "==", lessonId).get()
    ]);
    const schoolClass = await loadSchoolClass(data.classId, req.user!);
    const memberIds = members.docs.length ? members.docs.map((doc) => doc.data().userId as string) : schoolClass?.studentIds ?? [];
    const users = memberIds.length ? await db.getAll(...memberIds.map((uid) => db.collection("users").doc(uid))) : [];
    const attendanceByStudent = new Map(attendance.docs.map((doc) => [String(doc.data().studentId), { id: doc.id, status: String(doc.data().status) }]));
    const roster = users.filter((doc) => doc.exists).map((doc) => ({ uid: doc.id, displayName: doc.data()?.displayName ?? "Estudante", registration: doc.data()?.registration, status: attendanceByStudent.get(doc.id)?.status ?? "pending", attendanceId: attendanceByStudent.get(doc.id)?.id ?? null })).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    res.json({ lesson: renderLesson(lesson.id, data), roster });
  } catch (error) { next(error); }
});

const manualStatusSchema = z.object({ status: z.enum(["present", "absent", "justified"]), note: z.string().trim().max(300).optional() });
lessonsRouter.patch("/:lessonId/attendance/:studentId", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const lessonId = routeParam(req.params.lessonId);
    const studentId = routeParam(req.params.studentId);
    const parsed = manualStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Situação de presença inválida." });
    const lessonRef = db.collection("lessons").doc(lessonId);
    const lessonSnapshot = await lessonRef.get();
    if (!lessonSnapshot.exists || lessonSnapshot.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Aula não encontrada." });
    const lesson = lessonSnapshot.data()!;
    if (req.user!.role === "teacher" && lesson.teacherId !== req.user!.uid) return res.status(403).json({ error: "Somente o professor responsável pode alterar a chamada." });
    if (!await isClassMember(lesson.classId, { ...req.user!, uid: studentId, classIds: [] }, "student")) return res.status(404).json({ error: "Estudante não está vinculado a esta turma." });
    const attendanceRef = db.collection("attendance").doc(`${lessonId}_${studentId}`);
    const eventRef = db.collection("attendance_events").doc();
    const result = await db.runTransaction(async (transaction) => {
      const [currentLesson, previous] = await Promise.all([transaction.get(lessonRef), transaction.get(attendanceRef)]);
      if (!currentLesson.exists || currentLesson.data()?.status !== "active") throw new HttpError(409, "A chamada manual só pode ser alterada enquanto a aula está em andamento.");
      const previousStatus = previous.data()?.status ?? null;
      const status = parsed.data.status;
      const now = Timestamp.now();
      const record = { schoolId: lesson.schoolId, schemaVersion: 1, lessonId, classId: lesson.classId, studentId, status, method: "manual", markedBy: req.user!.uid, recordedAt: previous.data()?.recordedAt ?? now, updatedAt: now, ...(parsed.data.note ? { note: parsed.data.note } : {}) };
      if (previous.exists) transaction.set(attendanceRef, record, { merge: true }); else transaction.create(attendanceRef, record);
      transaction.create(eventRef, { schoolId: lesson.schoolId, schemaVersion: 1, lessonId, classId: lesson.classId, studentId, previousStatus, newStatus: status, note: parsed.data.note ?? null, changedBy: req.user!.uid, createdAt: now });
      if ((previousStatus === "present") !== (status === "present")) transaction.update(lessonRef, { presentCount: FieldValue.increment(status === "present" ? 1 : -1), updatedAt: now });
      return { id: attendanceRef.id, ...serializeData(record) };
    });
    res.json({ attendance: result });
  } catch (error) { next(error); }
});

lessonsRouter.post("/:lessonId/close", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const lessonId = routeParam(req.params.lessonId);
    const lessonRef = db.collection("lessons").doc(lessonId);
    const lessonSnapshot = await lessonRef.get();
    if (!lessonSnapshot.exists || lessonSnapshot.data()?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Aula não encontrada." });
    const lesson = lessonSnapshot.data()!;
    if (req.user!.role === "teacher" && lesson.teacherId !== req.user!.uid) return res.status(403).json({ error: "Somente o professor responsável pode encerrar a aula." });
    await lessonRef.update({ status: "closed", closedAt: Timestamp.now(), qrNonce: null, updatedAt: Timestamp.now() });
    const [members, existing] = await Promise.all([
      db.collection("class_memberships").where("classId", "==", lesson.classId).where("role", "==", "student").get(),
      db.collection("attendance").where("lessonId", "==", lessonId).get()
    ]);
    const marked = new Set(existing.docs.map((doc) => String(doc.data().studentId)));
    const memberIds = members.docs.length ? members.docs.map((doc) => String(doc.data().userId)) : (await loadSchoolClass(lesson.classId, req.user!))?.studentIds ?? [];
    const unmarked = memberIds.filter((studentId) => !marked.has(studentId));
    const now = Timestamp.now();
    for (let offset = 0; offset < unmarked.length; offset += 400) {
      const batch = db.batch();
      for (const studentId of unmarked.slice(offset, offset + 400)) {
        const attendanceRef = db.collection("attendance").doc(`${lessonId}_${studentId}`);
        batch.create(attendanceRef, { schoolId: lesson.schoolId, schemaVersion: 1, lessonId, classId: lesson.classId, studentId, status: "absent", method: "manual", markedBy: req.user!.uid, absenceReason: "not-marked-before-close", recordedAt: now });
      }
      await batch.commit();
    }
    res.json({ lesson: { id: lessonSnapshot.id, status: "closed", absencesAdded: unmarked.length } });
  } catch (error) { next(error); }
});
