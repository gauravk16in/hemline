import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  originCheck,
  isLocalDemo,
  session,
  signSession,
  workerCheck,
} from "../lib/security";
it("accepts same-host browser writes when Next normalizes request origin", () => {
  expect(() =>
    originCheck(
      new NextRequest("http://localhost:3000/api/messages", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  ).not.toThrow();
});
it("rejects cross-site writes", () => {
  expect(() =>
    originCheck(
      new NextRequest("http://localhost:3000/api/messages", {
        headers: { host: "127.0.0.1:3000", origin: "https://attacker.example" },
      }),
    ),
  ).toThrow();
});
it("rejects tampered signed identity", () => {
  const token = signSession("owner", "sandbox");
  const req = new NextRequest("http://localhost/api/ward", {
    headers: { cookie: `hemline_session=${token}` },
  });
  expect(session(req).owner).toBe("owner");
  const bad = new NextRequest("http://localhost/api/ward", {
    headers: { cookie: `hemline_session=${token.slice(0, -1)}X` },
  });
  expect(() => session(bad)).toThrow();
});
it("internal tick rejects missing credentials", () => {
  expect(() =>
    workerCheck(new NextRequest("http://localhost/api/internal/tick")),
  ).toThrow();
});

it("bypasses public admission only in private development mode", () => {
  try {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_DEMO_ENABLED", "false");
    expect(isLocalDemo()).toBe(true);
    vi.stubEnv("PUBLIC_DEMO_ENABLED", "true");
    expect(isLocalDemo()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_DEMO_ENABLED", "false");
    expect(isLocalDemo()).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
