import { createHash, randomBytes } from "node:crypto";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function sessionCookieName(nodeEnvironment = process.env.NODE_ENV) {
  return nodeEnvironment === "production" ? "__Host-nsct_session" : "nsct_session";
}

export function sessionVersionCookieName(nodeEnvironment = process.env.NODE_ENV) {
  return nodeEnvironment === "production" ? "__Host-nsct_session_version" : "nsct_session_version";
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}
