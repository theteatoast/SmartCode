# ⚡ SmartCode

**The runtime layer for efficient AI coding.**

SmartCode is a terminal-first optimization runtime that wraps Claude Code and OpenCode, making your AI coding sessions measurably more efficient — less waste, fewer loops, smarter context.

## How It Works

```
Developer ←→ SmartCode (PTY Layer) ←→ Claude Code / OpenCode
                    │
         ┌──────────┼──────────┐
         │          │          │
    Loop Detector  Cache   Analytics
         │          │          │
         └──────────┼──────────┘
                    │
               SQLite DB
```

SmartCode spawns your coding agent inside a pseudo-terminal (via `node-pty`), giving it full bidirectional I/O interception while the agent runs exactly as if launched directly — same TUI, same colors, same interactive experience.

Behind the scenes, SmartCode:
- **Detects loops** — catches the agent re-reading files, repeating commands, or cycling through the same edits
- **Enforces response style** — injects system prompt rules so the agent responds concisely, with patches only, or commands only
- **Tracks real analytics** — every metric comes from actual observations, not hardcoded values
- **Persists session data** — historical stats across all your sessions in SQLite

## Install

```bash
npm install -g smartcode
```

## Usage

```bash
smartcode
```

Interactive launcher walks you through:

1. **Select agent** — Claude Code or OpenCode
2. **Optimization Level** — Safe (track only), Balanced (warn on loops), Aggressive (auto-intervene)
3. **Response Style** — Normal, Concise, Patch-only, Commands-only

Then SmartCode launches your agent with optimization hooks active.

## Optimization Levels

| Level | Behavior |
|-------|----------|
| **Safe** | Silent tracking only. Collects metrics without any intervention. |
| **Balanced** | Shows warnings when loops are detected. No agent modification. |
| **Aggressive** | Injects nudge messages into the agent when loops are detected. |

## Response Styles

| Style | What it does |
|-------|-------------|
| **Normal** | No modification to agent behavior |
| **Concise** | Injects system prompt: minimal explanations, no commentary |
| **Patch-only** | Agent responds only with code diffs/patches |
| **Commands-only** | Agent responds only with shell commands |

## Loop Detection

SmartCode detects these patterns in real-time:

- **File read loops** — same file read 2-5+ times (threshold varies by optimization level)
- **Command loops** — same shell command executed repeatedly
- **Error repetition** — same error appearing in cycles
- **Edit cycles** — file edited, reverted, edited again

## Session Analytics

After each session, SmartCode prints real metrics:

```
Session Summary
───────────────
Agent: opencode | Mode: concise | Level: balanced
Duration: 12m 34s | Interactions: 18
Loops Detected: 3
  └─ Repeated file reads: 2
  └─ Repeated commands: 1
Estimated Efficiency Gain: +12%
```

All session data is persisted to `~/.smartcode/smartcode.db`.

## Architecture

```
src/
├── index.ts              # CLI entry point
├── agents/
│   ├── base.ts           # Agent interface + config
│   ├── claude.ts          # Claude Code agent
│   └── opencode.ts        # OpenCode agent
├── core/
│   ├── runtime.ts         # Main orchestrator
│   ├── pty-manager.ts     # PTY-based I/O interception
│   ├── loop-detector.ts   # Real-time pattern detection
│   ├── prompt-injector.ts # System prompt injection
│   ├── analytics.ts       # Real metrics tracker
│   └── optimizer.ts       # Prompt optimization (future)
└── db/
    ├── cache.ts           # Semantic cache (SHA-256 + TTL)
    └── session.ts         # Session persistence
```

## License

ISC