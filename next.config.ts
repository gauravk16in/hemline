import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg", "neatlogs"],
  turbopack: { root: process.cwd() },
};
export default config;
