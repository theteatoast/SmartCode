# SmartCode

**Tagline:** Make your AI coding sessions last longer.

SmartCode is a terminal-first optimization runtime for Claude Code and OpenCode that helps developers get significantly more productive AI coding time by reducing waste, compressing context, preventing repetitive loops, caching prior work, and intelligently managing coding agent execution.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Launch SmartCode:
   ```bash
   npm start
   ```

   *Or run the development version directly:*
   ```bash
   npm run dev
   ```

## Architecture (Phase 1 MVP)

- **Agent Launcher**: `src/index.ts` / `src/core/runtime.ts`
- **Loop Detection**: `src/core/loopDetector.ts`
- **Prompt Optimizer**: `src/core/optimizer.ts`
- **Semantic Cache**: `src/db/cache.ts`
- **Agent Integrations**: `src/agents/`