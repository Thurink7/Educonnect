import type { NextFunction, Request, Response } from "express";
import { auth, db } from "../firebase";
import type { UserProfile, UserRole } from "@educonnect/shared";

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Autenticação necessária." });
    const decoded = await auth.verifyIdToken(header.slice(7));
    const snapshot = await db.collection("users").doc(decoded.uid).get();
    if (!snapshot.exists) return res.status(403).json({ error: "Perfil Educonnect não cadastrado." });
    const data = snapshot.data()!;
    if (!["coordination", "teacher", "student"].includes(data.role)) return res.status(403).json({ error: "Perfil inválido." });
    req.user = { uid: decoded.uid, schoolId: data.schoolId ?? "default", displayName: data.displayName ?? decoded.name ?? "", email: data.email ?? decoded.email ?? "", role: data.role as UserRole, classIds: data.classIds ?? [], teachingAssignments: data.teachingAssignments ?? [], registration: data.registration, guardian: data.guardian } satisfies UserProfile;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}

export function allowRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => req.user && roles.includes(req.user.role)
    ? next() : res.status(403).json({ error: "Seu perfil não pode realizar esta ação." });
}
