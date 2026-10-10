import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg", "neatlogs"],
  outputFileTracingIncludes: {
    "/api/*": ["./supabase/migrations/001_hemline.sql"],
  },
  turbopack: { root: process.cwd() },
};
export default config;
