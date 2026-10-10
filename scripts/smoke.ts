import nextEnv from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
await mkdir("evidence", { recursive: true });
if (!process.env.OPENAI_API_KEY || !process.env.NEATLOGS_API_KEY) {
  await writeFile(
    "evidence/provider-status.json",
    JSON.stringify(
      {
        status: "blocked",
        reason: "OPENAI_API_KEY and NEATLOGS_API_KEY are both required",
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.error("Provider smoke blocked: configure OpenAI and neatlogs");
  process.exit(1);
}
const { client, shutdownTelemetry } = await import("../lib/agent");
try {
  const api = await client();
  const response =
    process.env.MODEL_API === "chat"
      ? await api.chat.completions.create({
          model: process.env.OPENAI_MODEL || "claude-sonnet-4.6",
          messages: [
            {
              role: "user",
              content:
                "Reply with the word Hemline. Synthetic integration smoke test.",
            },
          ],
          max_tokens: 32,
        })
      : await api.responses.create({
          model: process.env.OPENAI_MODEL || "claude-sonnet-4.6",
          input:
            "Reply with the word Hemline. Synthetic integration smoke test.",
          max_output_tokens: 32,
          store: false,
        });

  await writeFile(
    "evidence/provider-status.json",
    JSON.stringify(
      {
        status: "model_response_verified_export_attempted",
        model: response.model,
        responseId: response.id,
        usage: response.usage,
        at: new Date().toISOString(),
        remaining:
          "Verify finalized trace readback in neatlogs; a successful flush alone is not proof of export.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Real model response received. Verify neatlogs readback before marking export verified.",
  );
} catch (error) {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : null;
  await writeFile(
    "evidence/provider-status.json",
    JSON.stringify(
      {
        status: "failed",
        httpStatus: status,
        reason:
          "Provider smoke failed; inspect provider account access without logging credentials",
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.error("Provider smoke failed", status ?? "network/provider error");
  process.exitCode = 1;
} finally {
  await shutdownTelemetry();
}
process.exit(process.exitCode || 0);
