import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Router } from "express";
import { z } from "zod";
import type { AttendanceStatus } from "@educonnect/shared";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { HttpError } from "../services/http-error";
import { verifyAttendanceToken } from "../services/qr";
import { distanceInMeters, serializeData } from "../services/serialize";

export const attendanceRouter = Router();
const scanSchema = z.object({ token: z.string().min(1).max(2048), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().min(0).max(150) }) });

attendanceRouter.post("/scan", allowRoles("student"), async (req, res, next) => {
  try {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "QR Code ou localização inválidos. Permita o acesso à localização e tente novamente." });
    const tokenCheck = verifyAttendanceToken(parsed.data.token);
    if (!tokenCheck.valid) {
      const message = tokenCheck.reason === "expired"
        ? "Este QR Code expirou. Leia o código atual exibido pelo professor."
        : tokenCheck.reason === "signature"
          ? "A assinatura do QR não corresponde ao servidor. Confira se todas as instâncias da API usam a mesma QR_TOKEN_SECRET."
          : "Não foi possível ler este QR Code. Aponte a câmera para o código exibido pelo professor.";
      return res.status(tokenCheck.reason === "expired" ? 410 : 400).json({ error: message });
    }
    const payload = tokenCheck.payload;
    if (payload.schoolId !== req.user!.schoolId) return res.status(403).json({ error: "Este QR Code pertence a outro colégio." });
    const lessonRef = db.collection("lessons").doc(payload.lessonId);
    const classRef = db.collection("classes").doc(payload.classId);
    const membershipRef = db.collection("class_memberships").doc(`${payload.classId}_${req.user!.uid}`);
    const attendanceRef = db.collection("attendance").doc(`${payload.lessonId}_${req.user!.uid}`);
    const result = await db.runTransaction(async (transaction) => {
      const [lessonSnapshot, classSnapshot, membershipSnapshot, attendanceSnapshot] = await Promise.all([transaction.get(lessonRef), transaction.get(classRef), transaction.get(membershipRef), transaction.get(attendanceRef)]);
      if (!lessonSnapshot.exists || !classSnapshot.exists) throw new HttpError(404, "Aula não encontrada.");
      const lesson = lessonSnapshot.data()!;
      const schoolClass = classSnapshot.data()!;
      if (lesson.status !== "active") throw new HttpError(409, "Esta aula já foi encerrada. Solicite ao professor uma chamada ativa.");
      if (lesson.classId !== payload.classId) throw new HttpError(400, "Este QR Code não corresponde à aula aberta. Leia novamente o código exibido pelo professor.");
      if (Timestamp.now().toMillis() >= payload.expiresAt) throw new HttpError(410, "Este QR Code expirou. Aguarde o código atual e tente novamente.");
      if (lesson.mode !== "in-person") throw new HttpError(409, "A chamada por QR está disponível somente para aulas presenciais.");
      if ((schoolClass.schoolId ?? "default") !== req.user!.schoolId || lesson.schoolId !== req.user!.schoolId) throw new HttpError(403, "Esta aula pertence a outro colégio.");
      const legacyMember = !membershipSnapshot.exists && req.user!.classIds?.includes(payload.classId);
      if ((!membershipSnapshot.exists && !legacyMember) || (membershipSnapshot.exists && membershipSnapshot.data()?.role !== "student")) throw new HttpError(403, "Esta aula não está vinculada à sua turma.");
      const room = lesson.location ?? schoolClass.location;
      if (!room || typeof room.latitude !== "number" || typeof room.longitude !== "number" || typeof room.radiusMeters !== "number") throw new HttpError(409, "O professor ainda não definiu a localização para esta aula.");
      const distance = distanceInMeters(room, parsed.data.location);
      const tolerance = Math.min(10, parsed.data.location.accuracyMeters);
      if (distance > room.radiusMeters + tolerance) throw new HttpError(403, "Você está fora da área permitida para registrar presença. Aproxime-se da sala e tente novamente.");
      if (attendanceSnapshot.exists) return { recorded: false, message: "Sua presença já foi registrada nesta aula." };
      const now = Timestamp.now();
      transaction.create(attendanceRef, { schoolId: req.user!.schoolId, schemaVersion: 1, lessonId: payload.lessonId, classId: payload.classId, studentId: req.user!.uid, status: "present", method: "qr", markedBy: req.user!.uid, recordedAt: now, location: { verified: true, distanceMeters: Math.round(distance), accuracyMeters: Math.round(parsed.data.location.accuracyMeters) } });
      transaction.update(lessonRef, { presentCount: FieldValue.increment(1), updatedAt: now });
      return { recorded: true, message: "Presença confirmada!" };
    });
    res.status(result.recorded ? 201 : 200).json(result);
  } catch (error) { next(error); }
});

attendanceRouter.get("/me", allowRoles("student"), async (req, res, next) => {
  try {
    const days = Math.min(180, Math.max(7, Number(req.query.days) || 90));
    const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshot = await db.collection("attendance").where("studentId", "==", req.user!.uid).where("recordedAt", ">=", since).orderBy("recordedAt", "desc").limit(300).get();
    const records = snapshot.docs.map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<{ id: string; classId: string; lessonId: string; status: string; recordedAt: string }>;
    const classIds = [...new Set(records.map((record) => String(record.classId)))];
    const lessonIds = [...new Set(records.map((record) => String(record.lessonId)))];
    const [classes, lessons] = await Promise.all([
      classIds.length ? db.getAll(...classIds.map((id) => db.collection("classes").doc(id))) : [],
      lessonIds.length ? db.getAll(...lessonIds.map((id) => db.collection("lessons").doc(id))) : []
    ]);
    const classNames = new Map(classes.filter((doc) => doc.exists).map((doc) => [doc.id, String(doc.data()?.name ?? "Turma")]));
    const lessonDetails = new Map(lessons.filter((doc) => doc.exists).map((doc) => [doc.id, serializeData(doc.data()!)]));
    const history = records.map((record) => ({ ...record, className: classNames.get(String(record.classId)) ?? "Turma", subject: lessonDetails.get(String(record.lessonId))?.subject ?? "Aula", startsAt: lessonDetails.get(String(record.lessonId))?.startsAt }));
    const present = records.filter((record) => record.status === "present").length;
    const absent = records.filter((record) => record.status === "absent").length;
    const justified = records.filter((record) => record.status === "justified").length;
    res.json({ summary: { total: records.length, present, absent, justified, attendanceRate: present + absent ? Math.round(present / (present + absent) * 1000) / 10 : 100, days }, history });
  } catch (error) { next(error); }
});

export function isAttendanceStatus(value: unknown): value is AttendanceStatus { return value === "present" || value === "absent" || value === "justified"; }
