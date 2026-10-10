import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { backend } = await import("../lib/store");
await backend();
console.log(
  process.env.DATABASE_URL || process.env.POSTGRES_URL
    ? "Hosted migration applied"
    : "Local embedded PostgreSQL initialized",
);
process.exit(0);
