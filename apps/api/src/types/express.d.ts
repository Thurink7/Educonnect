import type { UserProfile } from "@educonnect/shared";
declare global {
  namespace Express { interface Request { user?: UserProfile; } }
}
export {};
