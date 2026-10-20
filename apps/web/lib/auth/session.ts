import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getWebEnv } from "@/lib/env";

export const SESSION_COOKIE = "mg_session";
const MAX_AGE_SEC = 7 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  wallet: string;
  exp: number;
}

function sign(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readSessionToken(token: string, secret: string): SessionPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || !payload.wallet || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function makeSessionToken(userId: string, wallet: string, secret: string): string {
  return sign({ userId, wallet, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC }, secret);
}

export async function setSessionCookie(userId: string, wallet: string): Promise<void> {
  const env = getWebEnv();
  const store = await cookies();
  store.set(SESSION_COOKIE, makeSessionToken(userId, wallet, env.SESSION_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const env = getWebEnv();
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return readSessionToken(raw, env.SESSION_SECRET);
}
