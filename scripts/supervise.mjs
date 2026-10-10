import { spawn } from "node:child_process";
const port = process.env.PORT || "3000";
const secret = process.env.WORKER_SECRET;
if (!secret || !process.env.DATABASE_URL) {
  console.error("Production requires WORKER_SECRET and DATABASE_URL");
  process.exit(1);
}
const env = { ...process.env, INTERNAL_BASE_URL: `http://127.0.0.1:${port}` };
const children = [
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      port,
    ],
    { stdio: "inherit", env },
  ),
  spawn(process.execPath, ["dist/worker.mjs"], { stdio: "inherit", env }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 15000).unref();
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) =>
          child.exitCode !== null ? resolve() : child.once("exit", resolve),
        ),
    ),
  ).then(() => process.exit(code));
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", () => {
    if (!stopping) stop(1);
  });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
