import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = process.env.QR_TOKEN_SECRET;
if (!secret || secret.length < 32) throw new Error("QR_TOKEN_SECRET must contain at least 32 characters");
const qrSecret: string = secret;

export interface AttendanceToken { lessonId: string; classId: string; schoolId: string; nonce: string; expiresAt: number; }
export type AttendanceTokenVerification =
  | { valid: true; payload: AttendanceToken }
  | { valid: false; reason: "malformed" | "signature" | "expired" };
export function createAttendanceToken(lessonId: string, classId: string, schoolId: string, lifetimeSeconds = 10) {
  const payload: AttendanceToken = { lessonId, classId, schoolId, nonce: randomBytes(16).toString("hex"), expiresAt: Date.now() + lifetimeSeconds * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", qrSecret).update(body).digest("base64url");
  return { token: `${body}.${signature}`, payload };
}

export function verifyAttendanceToken(token: string): AttendanceTokenVerification {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { valid: false, reason: "malformed" };
  const expected = createHmac("sha256", qrSecret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return { valid: false, reason: "malformed" }; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false, reason: "signature" };
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AttendanceToken;
    if (typeof data.lessonId !== "string" || typeof data.classId !== "string" || typeof data.schoolId !== "string" || typeof data.nonce !== "string" || !Number.isFinite(data.expiresAt)) return { valid: false, reason: "malformed" };
    if (data.expiresAt <= Date.now()) return { valid: false, reason: "expired" };
    return { valid: true, payload: data };
  } catch { return { valid: false, reason: "malformed" }; }
}
