/**
 * Real-time loop detection engine.
 * 
 * Analyzes the agent's output stream to detect repetitive patterns:
 * - Same file being read multiple times
 * - Same shell command executed repeatedly
 * - Same error appearing in a cycle
 * - Edit-revert-edit cycles
 * 
 * Each detected loop is logged with type, content, and count.
 * 
 * IMPORTANT: Both Claude Code and OpenCode use interactive TUI frameworks
 * (Ink/React for Claude, Bubble Tea for OpenCode) that constantly redraw
 * the screen. The detector must filter out TUI rendering artifacts like
 * status bars, progress indicators, and panel redraws.
 */

export interface LoopEvent {
  type: 'file_read' | 'command_exec' | 'error_repeat' | 'edit_cycle' | 'generic';
  content: string;
  count: number;
  timestamp: number;
  intervened: boolean;
}

export type OptimizationLevel = 'safe' | 'balanced' | 'aggressive';

// ── TUI Noise Filters ──────────────────────────────────────────────────────
// Lines matching these patterns are TUI rendering artifacts (status bars,
// progress indicators, panel redraws) and must be stripped before analysis.
const TUI_NOISE_PATTERNS = [
  // Status bars, spinners, and progress indicators
  /^[\s│┃|]*[●○◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷▏▎▍▌▋▊▉█░▒▓·•…]/, 
  // OpenCode/Claude status lines (model names, costs, token counts)
  /\b\d+(\.\d+)?[KkMm]?\s*\(\d+%?\)\s*·?\s*\$[\d.]+/,
  /\b(esc|ctrl\+\w|enter|tab)\b.*\b(interrupt|submit|commands|cancel)\b/i,
  // Version strings, session IDs
  /(?:opencode|claude)\s+[\d.]+/i,
  // Short lines that are likely UI chrome (borders, separators, etc.)
  /^[\s─━═│┃┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬░▒▓█▄▀·•→←↑↓►◄▶◀]+$/,
  // Cursor movement residue and bare control chars
  /^\s{0,4}[A-Z][a-z]{0,2}\s*$/,  // Two/three letter fragments from redraws
  // Build/session indicator lines
  /^\s*(?:Build|Session|Continue)\s*·/,
];

// ── Agent Action Patterns ──────────────────────────────────────────────────
// These are more specific than before to avoid matching TUI noise.
// Each pattern requires clear contextual markers that TUI redraws don't have.

const FILE_READ_PATTERNS = [
  // Claude Code: "Read file: path/to/file.ts"  or  "Reading path/to/file.ts"
  /^\s*(?:Read(?:ing)?)\s+(?:file:?\s*)?[`"']?([^\s`"'\n]{4,}\.\w{1,10})[`"']?\s*$/gim,
  // Shell commands that read files
  /^\s*(?:cat|less|head|tail|bat)\s+([^\s|>\n]{4,}\.\w{1,10})\s*$/gim,
];

const COMMAND_EXEC_PATTERNS = [
  // Claude Code: "Running: npm test"  OpenCode: "Executing: npm test"
  /^\s*(?:Running|Executing)[:\s]+[`"']?(.{5,120})[`"']?\s*$/gim,
  // Shell prompt with actual command ($ npm test, ❯ npm test)
  /^\s*\$\s+(.{5,120})\s*$/gim,
];

const ERROR_PATTERNS = [
  // Explicit error lines with substantive content (not single words)
  /^\s*(?:error|Error|ERROR|FAIL|Failed|FAILED)[:\s]+(.{10,})/gim,
];

const EDIT_PATTERNS = [
  // Claude Code: "Edited file: path/to/file.ts"  OpenCode: "Writing path/to/file.ts"
  /^\s*(?:Edit(?:ing|ed)?|Writ(?:e|ing|ten|wrote)|Updat(?:e|ing|ed))\s+(?:file:?\s*)?[`"']?([^\s`"'\n]{4,}\.\w{1,10})[`"']?\s*$/gim,
];

export class LoopDetector {
  private fileReadHistory: Map<string, number> = new Map();
  private commandHistory: Map<string, number> = new Map();
  private errorHistory: Map<string, number> = new Map();
  private editHistory: Map<string, { count: number; lastAction: 'edit' | 'revert' }> = new Map();
  private genericHistory: Map<string, number> = new Map();

  /** Track which pattern+count combos have been reported to avoid duplicate events */
  private reportedPatterns: Set<string> = new Set();

  /** All detected loop events this session */
  public events: LoopEvent[] = [];

  /** Thresholds per optimization level */
  private thresholds: Record<OptimizationLevel, number> = {
    safe: 5,       // Very tolerant — only flag extreme repetition
    balanced: 3,   // Flag after 3 repeats
    aggressive: 3, // Same threshold as balanced (was 2, too aggressive for TUI agents)
  };

  private level: OptimizationLevel;

  constructor(level: OptimizationLevel = 'balanced') {
    this.level = level;
  }

  /**
   * Clean TUI noise from agent output before analysis.
   * Removes status bars, spinners, panel borders, and other
   * rendering artifacts that would cause false positive detections.
   */
  private cleanTuiNoise(output: string): string {
    const lines = output.split('\n');
    const cleanLines = lines.filter(line => {
      const trimmed = line.trim();
      // Skip empty or very short lines (UI fragments)
      if (trimmed.length < 8) return false;
      // Skip lines matching TUI noise patterns
      for (const pattern of TUI_NOISE_PATTERNS) {
        if (pattern.test(trimmed)) return false;
      }
      return true;
    });
    return cleanLines.join('\n');
  }

  /**
   * Analyze a chunk of agent output for loop patterns.
   * Returns any newly detected loop events.
   */
  analyzeOutput(output: string): LoopEvent[] {
    // Clean TUI noise first — this is critical for avoiding false positives
    const cleanOutput = this.cleanTuiNoise(output);
    if (cleanOutput.trim().length < 10) return [];

    const newEvents: LoopEvent[] = [];
    const threshold = this.thresholds[this.level];

    // --- Detect file read loops ---
    for (const pattern of FILE_READ_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(cleanOutput)) !== null) {
        const file = this.normalizePath(match[1]);
        if (this.isLikelyNoise(file)) continue;

        const count = (this.fileReadHistory.get(file) ?? 0) + 1;
        this.fileReadHistory.set(file, count);

        if (count >= threshold && this.shouldReport('file_read', file, count, threshold)) {
          const event = this.createEvent('file_read', file, count);
          newEvents.push(event);
        }
      }
    }

    // --- Detect command execution loops ---
    for (const pattern of COMMAND_EXEC_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(cleanOutput)) !== null) {
        const cmd = match[1].trim();
        if (cmd.length < 5 || cmd.length > 200) continue;
        if (this.isLikelyNoise(cmd)) continue;

        const normalized = this.normalizeCommand(cmd);
        const count = (this.commandHistory.get(normalized) ?? 0) + 1;
        this.commandHistory.set(normalized, count);

        if (count >= threshold && this.shouldReport('command_exec', normalized, count, threshold)) {
          const event = this.createEvent('command_exec', cmd, count);
          newEvents.push(event);
        }
      }
    }

    // --- Detect repeated errors ---
    for (const pattern of ERROR_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(cleanOutput)) !== null) {
        const error = match[1].trim().substring(0, 100);
        if (this.isLikelyNoise(error)) continue;

        const normalized = error.toLowerCase();
        const count = (this.errorHistory.get(normalized) ?? 0) + 1;
        this.errorHistory.set(normalized, count);

        if (count >= threshold && this.shouldReport('error_repeat', normalized, count, threshold)) {
          const event = this.createEvent('error_repeat', error, count);
          newEvents.push(event);
        }
      }
    }

    // --- Detect edit cycles ---
    for (const pattern of EDIT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(cleanOutput)) !== null) {
        const file = this.normalizePath(match[1]);
        if (this.isLikelyNoise(file)) continue;

        const history = this.editHistory.get(file) ?? { count: 0, lastAction: 'edit' as const };
        history.count += 1;
        this.editHistory.set(file, history);

        if (history.count >= threshold + 1 && this.shouldReport('edit_cycle', file, history.count, threshold + 1)) {
          const event = this.createEvent('edit_cycle', file, history.count);
          newEvents.push(event);
        }
      }
    }

    return newEvents;
  }

  /**
   * Analyze using a simple line-similarity heuristic.
   * If the same block of text (>100 chars) appears repeatedly,
   * that's a generic loop.
   */
  analyzeGenericRepetition(output: string): LoopEvent[] {
    const cleanOutput = this.cleanTuiNoise(output);
    if (cleanOutput.trim().length < 100) return [];

    const newEvents: LoopEvent[] = [];
    const threshold = this.thresholds[this.level];

    // Split into meaningful chunks (paragraphs) — require 100+ chars to filter noise
    const chunks = cleanOutput.split(/\n{2,}/).filter(c => c.trim().length > 100);

    for (const chunk of chunks) {
      const key = this.hashChunk(chunk.trim());
      const count = (this.genericHistory.get(key) ?? 0) + 1;
      this.genericHistory.set(key, count);

      if (count >= threshold && this.shouldReport('generic', key, count, threshold)) {
        const preview = chunk.trim().substring(0, 80) + '...';
        const event = this.createEvent('generic', preview, count);
        newEvents.push(event);
      }
    }

    return newEvents;
  }

  /**
   * Mark a loop event as intervened (SmartCode took action).
   */
  markIntervened(event: LoopEvent): void {
    event.intervened = true;
  }

  /**
   * Get a nudge message for the user based on the loop type.
   */
  getNudgeMessage(event: LoopEvent): string {
    switch (event.type) {
      case 'file_read':
        return `File "${event.content}" read ${event.count} times — content unchanged.`;
      case 'command_exec':
        return `Command "${event.content}" executed ${event.count} times with same result.`;
      case 'error_repeat':
        return `Same error repeated ${event.count} times: "${event.content}"`;
      case 'edit_cycle':
        return `File "${event.content}" edited ${event.count} times — possible edit cycle.`;
      case 'generic':
        return `Repeated pattern detected (${event.count}x).`;
    }
  }

  /**
   * Get summary statistics.
   */
  getStats(): { totalDetected: number; totalIntervened: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    let totalIntervened = 0;

    for (const event of this.events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      if (event.intervened) totalIntervened++;
    }

    return {
      totalDetected: this.events.length,
      totalIntervened,
      byType,
    };
  }

  /**
   * Reset all history (e.g., on session boundary).
   */
  reset(): void {
    this.fileReadHistory.clear();
    this.commandHistory.clear();
    this.errorHistory.clear();
    this.editHistory.clear();
    this.genericHistory.clear();
    this.reportedPatterns.clear();
    this.events = [];
  }

  // --- Private helpers ---

  private createEvent(type: LoopEvent['type'], content: string, count: number): LoopEvent {
    const event: LoopEvent = {
      type,
      content,
      count,
      timestamp: Date.now(),
      intervened: false,
    };
    this.events.push(event);
    return event;
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  private normalizeCommand(cmd: string): string {
    return cmd.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private hashChunk(text: string): string {
    const trimmed = text.replace(/\s+/g, ' ').toLowerCase();
    return `${trimmed.substring(0, 20)}:${trimmed.length}:${trimmed.substring(trimmed.length - 20)}`;
  }

  /**
   * Check if a matched string is likely TUI noise rather than real content.
   */
  private isLikelyNoise(text: string): boolean {
    // Too short to be a real file path or command
    if (text.length < 4) return true;
    // Contains box-drawing chars or heavy unicode (TUI chrome)
    if (/[─━═│┃┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬░▒▓█▄▀●○◐◑]/.test(text)) return true;
    // Looks like a version string or status fragment
    if (/^\d+\.\d+\.\d+/.test(text)) return true;
    // Single word that could be a UI label
    if (!/\s/.test(text) && !/[./\\]/.test(text) && text.length < 15) return true;
    return false;
  }

  /**
   * Determine if a pattern should be reported at this count.
   * Reports at threshold, then at exponentially increasing intervals
   * (2x, 4x, 8x threshold) to avoid spamming events.
   */
  private shouldReport(type: string, key: string, count: number, threshold: number): boolean {
    const reportKey = `${type}:${key}:${count}`;
    if (this.reportedPatterns.has(reportKey)) return false;

    let reportAt = threshold;
    while (reportAt < count) {
      reportAt *= 2;
    }
    if (count !== reportAt && count !== threshold) return false;

    this.reportedPatterns.add(reportKey);
    return true;
  }
}
