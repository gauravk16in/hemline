import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
const origin =
  process.env.INTERNAL_BASE_URL ||
  process.env.APP_BASE_URL ||
  "http://127.0.0.1:3000";
while (!stopping) {
  try {
    const response = await fetch(`${origin}/api/internal/tick`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WORKER_SECRET || "local-worker"}`,
      },
      signal: AbortSignal.timeout(95000),
    });
    if (!response.ok) console.error("Worker tick", response.status);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Worker unavailable",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await fetch(`${origin}/api/internal/shutdown`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.WORKER_SECRET || "local-worker"}`,
  },
}).catch(() => {});
