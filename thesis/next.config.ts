import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 writes its own AGENTS.md / CLAUDE.md into the project on `next dev`.
  // This repo already has instructions of its own a level up, and a generated
  // file competing with them is worse than no file at all.
  agentRules: false,

  // The Bitget Agent Hub SDK is ESM-only and does its own dynamic catalog
  // loading — bundling it breaks operation resolution. Keep it external.
  serverExternalPackages: ['@bitget-ai/bitget-agent-sdk'],
};

export default nextConfig;
