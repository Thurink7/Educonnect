import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { auth, db } from "../firebase";
import { allowRoles } from "../middleware/auth";
import { routeParam, serializeData } from "../services/serialize";

export const usersRouter = Router();
usersRouter.use(allowRoles("coordination"));

const assignmentSchema = z.object({
  classId: z.string().min(1),
  subjects: z.array(z.string().trim().min(1).max(100)).min(1).max(20)
});

async function validateTeacherAssignments(assignments: Array<z.infer<typeof assignmentSchema>>, schoolId: string) {
  if (new Set(assignments.map((item) => item.classId)).size !== assignments.length) return "Selecione cada turma uma única vez.";
  const docs = assignments.length ? await db.getAll(...assignments.map((item) => db.collection("classes").doc(item.classId))) : [];
  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    const doc = docs[index];
    if (!doc.exists || (doc.data()?.schoolId ?? "default") !== schoolId || doc.data()?.status === "archived") return "Uma das turmas selecionadas não pertence a este colégio ou está arquivada.";
    const subjects = doc.data()?.subjects as string[] | undefined;
    if (!subjects?.length || assignment.subjects.some((subject) => !subjects.includes(subject))) return `Revise as disciplinas selecionadas para ${doc.data()?.name ?? "a turma"}.`;
  }
  return null;
}

usersRouter.get("/", async (req, res, next) => {
  try {
    const role = z.enum(["teacher", "student"]).optional().safeParse(req.query.role);
    if (!role.success) return res.status(400).json({ error: "Perfil de usuário inválido." });
    let query = db.collection("users").where("schoolId", "==", req.user!.schoolId);
    if (role.data) query = query.where("role", "==", role.data);
    const snapshot = await query.limit(300).get();
    res.json({ users: snapshot.docs.map((doc) => ({ uid: doc.id, ...serializeData(doc.data()) })) });
  } catch (error) { next(error); }
});

const newUserSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: z.string().min(10).max(128),
  role: z.enum(["teacher", "student"]),
  registration: z.string().trim().max(40).optional(),
  classIds: z.array(z.string().min(1)).max(50).default([]),
  teachingAssignments: z.array(assignmentSchema).max(50).default([]),
  guardian: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")), phone: z.string().trim().max(30).optional() }).optional()
}).superRefine((data, context) => {
  if (data.role === "student" && !data.registration) context.addIssue({ code: "custom", path: ["registration"], message: "Matrícula obrigatória para estudante." });
  if (data.role === "student" && !data.guardian?.name) context.addIssue({ code: "custom", path: ["guardian"], message: "Nome do responsável obrigatório para estudante." });
  if (data.role === "teacher" && data.classIds.length) context.addIssue({ code: "custom", path: ["classIds"], message: "Para professor, use as atribuições por turma." });
  if (data.role === "student" && data.teachingAssignments.length) context.addIssue({ code: "custom", path: ["teachingAssignments"], message: "Atribuições de disciplinas são exclusivas de professores." });
});

usersRouter.post("/", async (req, res, next) => {
  let createdUid: string | undefined;
  try {
    const parsed = newUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Revise nome, e-mail, senha e os dados obrigatórios do perfil." });
    const { password, guardian, classIds, teachingAssignments, ...fields } = parsed.data;
    if (fields.role === "teacher") {
      const assignmentError = await validateTeacherAssignments(teachingAssignments, req.user!.schoolId);
      if (assignmentError) return res.status(400).json({ error: assignmentError });
    } else if (classIds.length) {
      const classes = await db.getAll(...classIds.map((id) => db.collection("classes").doc(id)));
      if (new Set(classIds).size !== classIds.length || classes.some((doc) => !doc.exists || (doc.data()?.schoolId ?? "default") !== req.user!.schoolId || doc.data()?.status === "archived")) return res.status(400).json({ error: "Revise as turmas selecionadas para o estudante." });
    }

    const account = await auth.createUser({ email: fields.email, password, displayName: fields.displayName, emailVerified: false, disabled: false });
    createdUid = account.uid;
    const now = Timestamp.now();
    const selectedClassIds = fields.role === "teacher" ? teachingAssignments.map((item) => item.classId) : classIds;
    const profile: Record<string, unknown> = {
      displayName: fields.displayName, email: fields.email, role: fields.role, schoolId: req.user!.schoolId,
      schemaVersion: 1, createdBy: req.user!.uid, createdAt: now, updatedAt: now, classIds: selectedClassIds,
      ...(fields.role === "teacher" ? { teachingAssignments } : {})
    };
    if (fields.registration) profile.registration = fields.registration;
    if (guardian) profile.guardian = { name: guardian.name, ...(guardian.email ? { email: guardian.email } : {}), ...(guardian.phone ? { phone: guardian.phone } : {}) };
    const batch = db.batch();
    batch.create(db.collection("users").doc(account.uid), profile);
    for (const classId of selectedClassIds) {
      const membership = db.collection("class_memberships").doc(`${classId}_${account.uid}`);
      batch.create(membership, { classId, schoolId: req.user!.schoolId, schemaVersion: 1, userId: account.uid, role: fields.role, createdAt: now, createdBy: req.user!.uid });
    }
    await batch.commit();
    res.status(201).json({ user: { uid: account.uid, ...serializeData(profile) } });
  } catch (error) {
    if (createdUid) await auth.deleteUser(createdUid).catch(() => {});
    const code = (error as { code?: string })?.code;
    if (code === "auth/email-already-exists") return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
    next(error);
  }
});

const editUserSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: z.string().min(10).max(128).optional(),
  teachingAssignments: z.array(assignmentSchema).max(50).optional(),
  classIds: z.array(z.string().min(1)).max(50).optional(),
  registration: z.string().trim().min(1).max(40).optional(),
  guardian: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")), phone: z.string().trim().max(30).optional() }).optional()
});

usersRouter.patch("/:userId", async (req, res, next) => {
  try {
    const userId = routeParam(req.params.userId);
    const parsed = editUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Revise os dados do perfil e os vínculos de turma." });
    const profileRef = db.collection("users").doc(userId);
    const profileSnapshot = await profileRef.get();
    const oldProfile = profileSnapshot.data();
    if (!profileSnapshot.exists || oldProfile?.schoolId !== req.user!.schoolId || !["teacher", "student"].includes(String(oldProfile?.role))) return res.status(404).json({ error: "Pessoa não encontrada neste colégio." });
    const role = oldProfile.role as "teacher" | "student";
    const teachingAssignments: Array<z.infer<typeof assignmentSchema>> = role === "teacher" ? parsed.data.teachingAssignments ?? (oldProfile.teachingAssignments as Array<z.infer<typeof assignmentSchema>> | undefined) ?? [] : [];
    const classIds: string[] = role === "student" ? parsed.data.classIds ?? (oldProfile.classIds as string[] | undefined) ?? [] : teachingAssignments.map((item) => item.classId);
    if (role === "teacher") {
      const assignmentError = await validateTeacherAssignments(teachingAssignments, req.user!.schoolId);
      if (assignmentError) return res.status(400).json({ error: assignmentError });
    } else {
      const classes = classIds.length ? await db.getAll(...classIds.map((id) => db.collection("classes").doc(id))) : [];
      if (new Set(classIds).size !== classIds.length || classes.some((doc) => !doc.exists || (doc.data()?.schoolId ?? "default") !== req.user!.schoolId || doc.data()?.status === "archived")) return res.status(400).json({ error: "Revise as turmas selecionadas para o estudante." });
      if (!(parsed.data.registration ?? oldProfile.registration)) return res.status(400).json({ error: "Matrícula obrigatória para estudante." });
      if (!(parsed.data.guardian?.name ?? oldProfile.guardian?.name)) return res.status(400).json({ error: "Nome do responsável obrigatório para estudante." });
    }

    const account = await auth.getUser(userId);
    if (parsed.data.email !== account.email) {
      try {
        const emailOwner = await auth.getUserByEmail(parsed.data.email);
        if (emailOwner.uid !== userId) return res.status(409).json({ error: "Este e-mail já está em uso." });
      } catch (error) {
        if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
      }
    }
    await auth.updateUser(userId, { email: parsed.data.email, displayName: parsed.data.displayName, ...(parsed.data.password ? { password: parsed.data.password } : {}) });

    const existingMemberships = await db.collection("class_memberships").where("userId", "==", userId).get();
    const nextClassIds = [...new Set(classIds)];
    const now = Timestamp.now();
    const batch = db.batch();
    const profileUpdate: Record<string, unknown> = { displayName: parsed.data.displayName, email: parsed.data.email, classIds: nextClassIds, updatedAt: now };
    if (role === "teacher") profileUpdate.teachingAssignments = teachingAssignments;
    if (role === "student") {
      profileUpdate.registration = parsed.data.registration ?? oldProfile.registration;
      const guardian = parsed.data.guardian ?? oldProfile.guardian ?? {};
      profileUpdate.guardian = { name: guardian.name, ...(guardian.email ? { email: guardian.email } : {}), ...(guardian.phone ? { phone: guardian.phone } : {}) };
    }
    batch.update(profileRef, profileUpdate);
    const staleMemberships = existingMemberships.docs.filter((membership) => membership.data().schoolId === req.user!.schoolId && membership.data().role === role && !nextClassIds.includes(String(membership.data().classId)));
    for (const classId of nextClassIds) {
      const membership = db.collection("class_memberships").doc(`${classId}_${userId}`);
      batch.set(membership, { classId, schoolId: req.user!.schoolId, schemaVersion: 1, userId, role, updatedAt: now, updatedBy: req.user!.uid }, { merge: true });
    }
    if (staleMemberships.length + nextClassIds.length > 450) {
      await batch.commit();
      for (let offset = 0; offset < staleMemberships.length; offset += 450) {
        const cleanupBatch = db.batch();
        for (const membership of staleMemberships.slice(offset, offset + 450)) cleanupBatch.delete(membership.ref);
        await cleanupBatch.commit();
      }
    } else {
      for (const membership of staleMemberships) batch.delete(membership.ref);
      await batch.commit();
    }
    const result = { uid: userId, displayName: parsed.data.displayName, email: parsed.data.email, role, schoolId: req.user!.schoolId, classIds: nextClassIds, ...(role === "teacher" ? { teachingAssignments } : { registration: profileUpdate.registration, guardian: profileUpdate.guardian }) };
    res.json({ user: result });
  } catch (error) { next(error); }
});

usersRouter.delete("/:userId", async (req, res, next) => {
  try {
    const userId = routeParam(req.params.userId);
    if (userId === req.user!.uid) return res.status(400).json({ error: "A coordenação não pode excluir a própria conta por esta tela." });
    const profileRef = db.collection("users").doc(userId);
    const profile = await profileRef.get();
    if (!profile.exists || profile.data()?.schoolId !== req.user!.schoolId || !["teacher", "student"].includes(String(profile.data()?.role))) return res.status(404).json({ error: "Pessoa não encontrada neste colégio." });
    await auth.updateUser(userId, { disabled: true });
    const memberships = await db.collection("class_memberships").where("userId", "==", userId).get();
    const schoolMemberships = memberships.docs.filter((doc) => (doc.data().schoolId ?? "default") === req.user!.schoolId);
    for (let offset = 0; offset < schoolMemberships.length; offset += 450) {
      const batch = db.batch();
      for (const membership of schoolMemberships.slice(offset, offset + 450)) batch.delete(membership.ref);
      await batch.commit();
    }
    await profileRef.delete();
    await auth.deleteUser(userId);
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

