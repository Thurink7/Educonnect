import type { User } from "firebase/auth";

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const trimmedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");
const baseUrl = /\/api$/i.test(trimmedBaseUrl) ? trimmedBaseUrl : `${trimmedBaseUrl}/api`;
export async function apiRequest<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a solicitação.");
  return result as T;
}
