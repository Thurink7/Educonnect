import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { auth, db } from "../firebase";

const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 6) throw new Error("Defina DEMO_PASSWORD com pelo menos 6 caracteres.");

const demoUsers = [
  { email: "aluno@educonnect.test", displayName: "Aluno Demonstração", role: "student", registration: "DEMO001", guardian: { name: "Responsável Demonstração" } },
  { email: "professor@educonnect.test", displayName: "Professor Demonstração", role: "teacher" },
  { email: "coordenador@educonnect.test", displayName: "Coordenador Demonstração", role: "coordination" }
] as const;

async function main() {
  const accounts = await Promise.all(demoUsers.map(async (user) => {
    try { return { user, account: await auth.getUserByEmail(user.email) }; }
    catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return { user, account: null };
      throw error;
    }
  }));

  for (const { user, account } of accounts) {
    if (!account) continue;
    const profile = await db.collection("users").doc(account.uid).get();
    if (profile.exists && profile.data()?.role !== user.role) {
      throw new Error(`O e-mail ${user.email} já está associado a outro perfil; nenhuma conta foi alterada.`);
    }
  }

  const results: Array<{ email: string; role: string; uid: string; action: string }> = [];
  for (const { user, account: existing } of accounts) {
    const account = existing
      ? await auth.updateUser(existing.uid, { password, displayName: user.displayName, disabled: false })
      : await auth.createUser({ email: user.email, password, displayName: user.displayName, emailVerified: false, disabled: false });
    const now = Timestamp.now();
    const profile: Record<string, unknown> = {
      displayName: user.displayName, email: user.email, role: user.role,
      schoolId: process.env.FIREBASE_SCHOOL_ID || "default", schemaVersion: 1,
      ...(user.role === "student" ? { registration: user.registration, guardian: user.guardian } : {}),
      ...(existing ? {} : { createdAt: now }), updatedAt: now
    };
    await db.collection("users").doc(account.uid).set(profile, { merge: true });
    results.push({ email: user.email, role: user.role, uid: account.uid, action: existing ? "atualizada" : "criada" });
  }
  console.info(JSON.stringify({ schoolId: process.env.FIREBASE_SCHOOL_ID || "default", users: results }, null, 2));
}

main().catch((error) => { console.error("Criação das contas de demonstração não concluída.", error); process.exitCode = 1; });
