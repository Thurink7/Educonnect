import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import type { GradeSubmission, StudentReportCardEntry } from "@educonnect/shared";
import { db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { loadClassStudents, teacherCanTeach } from "../services/academic";
import { loadSchoolClass } from "../services/access";
import { routeParam, serializeData } from "../services/serialize";

export const gradeSubmissionsRouter = Router();

const submissionSchema = z.object({
  classId: z.string().min(1),
  subject: z.string().trim().min(1).max(100),
  academicYear: z.string().regex(/^20\d{2}$/, "Informe o ano letivo com quatro dígitos."),
  term: z.string().trim().min(1).max(40),
  gradeLabels: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  entries: z.array(z.object({ studentId: z.string().min(1), partialGrades: z.array(z.number().min(0).max(10).nullable()).max(12) })).min(1).max(400)
}).superRefine((value, context) => {
  if (new Set(value.entries.map((entry) => entry.studentId)).size !== value.entries.length) context.addIssue({ code: "custom", path: ["entries"], message: "A planilha contém alunos duplicados." });
  if (value.entries.some((entry) => entry.partialGrades.length !== value.gradeLabels.length)) context.addIssue({ code: "custom", path: ["entries"], message: "A quantidade de notas deve corresponder às avaliações informadas." });
});

async function prepareEntries(classId: string, body: z.infer<typeof submissionSchema>, schoolId: string) {
  const schoolClass = await loadSchoolClass(classId, { uid: "", schoolId, displayName: "", email: "", role: "coordination" });
  if (!schoolClass || schoolClass.status === "archived") throw new Error("Turma não encontrada ou arquivada.");
  const roster = await loadClassStudents(classId, schoolClass, schoolId);
  if (roster.length > 400) throw new Error("Esta turma excede o limite de 400 alunos por envio de notas.");
  if (roster.length !== body.entries.length || roster.some((student) => !body.entries.some((entry) => entry.studentId === student.studentId))) throw new Error("O envio precisa conter exatamente uma linha para cada estudante vinculado à turma.");
  const entries = roster.map((student) => {
    const grades = body.entries.find((entry) => entry.studentId === student.studentId)!.partialGrades;
    const scores = grades.filter((grade): grade is number => grade !== null);
    const average = scores.length ? Math.round(scores.reduce((sum, grade) => sum + grade, 0) / scores.length * 100) / 100 : null;
    return { ...student, partialGrades: grades, average };
  });
  return { schoolClass, entries };
}

gradeSubmissionsRouter.get("/", allowRoles("teacher", "coordination"), async (req, res, next) => {
  try {
    const snapshot = await db.collection("grade_submissions").where("schoolId", "==", req.user!.schoolId).limit(500).get();
    const submissions = snapshot.docs
      .filter((doc) => req.user!.role === "coordination" || doc.data().teacherId === req.user!.uid)
      .map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<GradeSubmission & { id: string; updatedAt?: string }>
    submissions
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    res.json({ submissions });
  } catch (error) { next(error); }
});

gradeSubmissionsRouter.post("/", allowRoles("teacher"), async (req, res, next) => {
  try {
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Revise o envio das notas." });
    const { schoolClass, entries } = await prepareEntries(parsed.data.classId, parsed.data, req.user!.schoolId);
    if (!await teacherCanTeach(req.user!, schoolClass, parsed.data.subject)) return res.status(403).json({ error: "Você não está vinculado a esta turma e disciplina." });
    const now = Timestamp.now();
    const ref = db.collection("grade_submissions").doc();
    const data = {
      schoolId: req.user!.schoolId, schemaVersion: 1, classId: schoolClass.id, className: schoolClass.name,
      subject: parsed.data.subject, teacherId: req.user!.uid, teacherName: req.user!.displayName,
      academicYear: parsed.data.academicYear, term: parsed.data.term, gradeLabels: parsed.data.gradeLabels,
      entries, status: "draft", feedback: null, createdAt: now, updatedAt: now
    };
    await ref.create(data);
    res.status(201).json({ submission: { id: ref.id, ...serializeData(data) } });
  } catch (error) { next(error); }
});

gradeSubmissionsRouter.patch("/:submissionId", allowRoles("teacher"), async (req, res, next) => {
  try {
    const submissionId = routeParam(req.params.submissionId);
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Revise o envio das notas." });
    const ref = db.collection("grade_submissions").doc(submissionId);
    const snapshot = await ref.get();
    const existing = snapshot.data();
    if (!snapshot.exists || existing?.schoolId !== req.user!.schoolId || existing?.teacherId !== req.user!.uid) return res.status(404).json({ error: "Envio de notas não encontrado." });
    if (existing.status !== "draft" && existing.status !== "rejected") return res.status(409).json({ error: "Este envio não pode mais ser editado." });
    const { schoolClass, entries } = await prepareEntries(parsed.data.classId, parsed.data, req.user!.schoolId);
    if (!await teacherCanTeach(req.user!, schoolClass, parsed.data.subject)) return res.status(403).json({ error: "Você não está vinculado a esta turma e disciplina." });
    await ref.update({ classId: schoolClass.id, className: schoolClass.name, subject: parsed.data.subject, academicYear: parsed.data.academicYear, term: parsed.data.term, gradeLabels: parsed.data.gradeLabels, entries, updatedAt: Timestamp.now() });
    const updated = await ref.get();
    res.json({ submission: { id: updated.id, ...serializeData(updated.data()!) } });
  } catch (error) { next(error); }
});

gradeSubmissionsRouter.post("/:submissionId/submit", allowRoles("teacher"), async (req, res, next) => {
  try {
    const submissionId = routeParam(req.params.submissionId);
    const ref = db.collection("grade_submissions").doc(submissionId);
    const snapshot = await ref.get();
    const data = snapshot.data();
    if (!snapshot.exists || data?.schoolId !== req.user!.schoolId || data?.teacherId !== req.user!.uid) return res.status(404).json({ error: "Envio de notas não encontrado." });
    if (data.status !== "draft" && data.status !== "rejected") return res.status(409).json({ error: "Somente rascunhos ou envios devolvidos podem ser enviados." });
    if (!(data.entries as Array<{ average: number | null }>).every((entry) => entry.average !== null)) return res.status(400).json({ error: "Preencha ao menos uma nota para cada aluno antes de enviar." });
    await ref.update({ status: "pending", feedback: null, submittedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    res.json({ status: "pending" });
  } catch (error) { next(error); }
});

gradeSubmissionsRouter.post("/:submissionId/review", allowRoles("coordination"), async (req, res, next) => {
  try {
    const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]), feedback: z.string().trim().max(1000).optional() });
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Informe a decisão da revisão." });
    if (parsed.data.decision === "reject" && !parsed.data.feedback) return res.status(400).json({ error: "Escreva o motivo da devolução ao professor." });
    const submissionId = routeParam(req.params.submissionId);
    const ref = db.collection("grade_submissions").doc(submissionId);
    const snapshot = await ref.get();
    const data = snapshot.data();
    if (!snapshot.exists || data?.schoolId !== req.user!.schoolId) return res.status(404).json({ error: "Envio de notas não encontrado." });
    if (data.status !== "pending") return res.status(409).json({ error: "Este envio já foi revisado ou não está aguardando aprovação." });
    const now = Timestamp.now();
    const batch = db.batch();
    const approved = parsed.data.decision === "approve";
    if (approved) {
      const entries = data.entries as Array<{ studentId: string; studentName: string; registration?: string; partialGrades: Array<number | null>; average: number | null }>;
      for (const entry of entries) {
        if (entry.average === null) return res.status(409).json({ error: "O envio contém estudante sem média calculada." });
        const gradeRef = db.collection("student_grades").doc(`${submissionId}_${entry.studentId}`);
        batch.set(gradeRef, {
          schoolId: req.user!.schoolId, schemaVersion: 1, batchId: submissionId,
          studentId: entry.studentId, studentName: entry.studentName, registration: entry.registration ?? null,
          classId: data.classId, className: data.className, subject: data.subject,
          teacherId: data.teacherId, teacherName: data.teacherName,
          academicYear: data.academicYear, term: data.term, gradeLabels: data.gradeLabels,
          partialGrades: entry.partialGrades, average: entry.average, approvedAt: now
        });
      }
    }
    batch.update(ref, { status: approved ? "approved" : "rejected", feedback: approved ? null : parsed.data.feedback, reviewedBy: req.user!.uid, reviewedAt: now, updatedAt: now });
    await batch.commit();
    res.json({ status: approved ? "approved" : "rejected" });
  } catch (error) { next(error); }
});

gradeSubmissionsRouter.get("/report-card", allowRoles("student"), async (req, res, next) => {
  try {
    const snapshot = await db.collection("student_grades").where("studentId", "==", req.user!.uid).limit(500).get();
    const grades = snapshot.docs
      .filter((doc) => doc.data().schoolId === req.user!.schoolId)
      .map((doc) => ({ id: doc.id, ...serializeData(doc.data()) })) as Array<StudentReportCardEntry & { id: string }>
    const latestByPeriod = new Map<string, StudentReportCardEntry & { id: string }>();
    for (const grade of grades) {
      const key = `${grade.classId}|${grade.subject}|${grade.academicYear}|${grade.term}`;
      const current = latestByPeriod.get(key);
      if (!current || grade.approvedAt > current.approvedAt) latestByPeriod.set(key, grade);
    }
    res.json({ grades: [...latestByPeriod.values()].sort((a, b) => `${b.academicYear}-${b.term}-${b.subject}`.localeCompare(`${a.academicYear}-${a.term}-${a.subject}`, "pt-BR")) });
  } catch (error) { next(error); }
});
