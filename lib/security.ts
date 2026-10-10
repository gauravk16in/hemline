import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { DomainError } from "./domain";
const g = globalThis as unknown as { hemlineSecret?: string };
function key() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production")
    throw new DomainError("CONFIG", "SESSION_SECRET required", 503);
  if (g.hemlineSecret) return g.hemlineSecret;
  mkdirSync(".data", { recursive: true });
  try {
    g.hemlineSecret = readFileSync(".data/session.key", "utf8");
  } catch {
    const generated = randomBytes(32).toString("hex");
    try {
      writeFileSync(".data/session.key", generated, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {}
    g.hemlineSecret = readFileSync(".data/session.key", "utf8");
  }
  return g.hemlineSecret;
}
export function signSession(owner: string, id: string) {
  const payload = Buffer.from(
    JSON.stringify({ owner, id, expires: Date.now() + 7200000 }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", key()).update(payload).digest("base64url")}`;
}
export function session(req: NextRequest) {
  const cookie = req.cookies.get("hemline_session")?.value;
  if (!cookie) throw new DomainError("AUTH", "Start a sandbox first", 401);
  const [payload, sig] = cookie.split(".");
  const expected = createHmac("sha256", key())
    .update(payload || "")
    .digest("base64url");
  if (
    !sig ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw new DomainError("AUTH", "Invalid session", 401);
  const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    owner: string;
    id: string;
    expires: number;
  };
  if (s.expires < Date.now())
    throw new DomainError("EXPIRED", "Session expired", 401);
  return s;
}
export function originCheck(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (
    origin &&
    new URL(origin).host !== req.headers.get("host") &&
    origin !== process.env.APP_BASE_URL
  )
    throw new DomainError("ORIGIN", "Cross-origin write rejected", 403);
}
export function workerCheck(req: NextRequest) {
  const key =
    process.env.WORKER_SECRET ||
    (process.env.NODE_ENV !== "production" ? "local-worker" : "");
  if (!key || req.headers.get("authorization") !== `Bearer ${key}`)
    throw new DomainError("AUTH", "Invalid worker credential", 401);
}
export function hash(value: string) {
  return createHmac("sha256", key()).update(value).digest("hex");
}
export function isLocalDemo() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PUBLIC_DEMO_ENABLED !== "true"
  );
}
export async function provisionIdentity(
  captchaToken: string | null,
  idem: string,
) {
  if (isLocalDemo()) return `local-${hash(idem)}`;
  if (process.env.PUBLIC_DEMO_ENABLED !== "true")
    throw new DomainError(
      "DISABLED",
      "Public provisioning is disabled until configured",
      503,
    );
  if (
    !captchaToken ||
    !process.env.TURNSTILE_SECRET_KEY ||
    !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    throw new DomainError(
      "CAPTCHA",
      "Supabase CAPTCHA configuration required",
      503,
    );
  const verification = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: captchaToken,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const verdict = (await verification.json()) as {
    success?: boolean;
    hostname?: string;
  };
  if (!verdict.success)
    throw new DomainError("CAPTCHA", "CAPTCHA verification failed", 403);
  if (
    process.env.APP_BASE_URL &&
    verdict.hostname !== new URL(process.env.APP_BASE_URL).hostname
  )
    throw new DomainError("CAPTCHA", "CAPTCHA hostname mismatch", 403);
  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { data, error } = await auth.auth.signInAnonymously();
  if (error || !data.user)
    throw new DomainError(
      "AUTH",
      "Anonymous sign-in failed. Check CAPTCHA and provider settings.",
      401,
    );
  return data.user.id;
}
