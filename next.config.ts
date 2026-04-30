import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Tell Next.js the tracing root is THIS project directory, not the parent
  // workspace root. Without this, Next.js detects the parent rssdeck/
  // package-lock.json and nests standalone output at
  // .next/standalone/.claude/worktrees/<id>/server.js instead of
  // .next/standalone/server.js.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
