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
 */

export interface LoopEvent {
  type: 'file_read' | 'command_exec' | 'error_repeat' | 'edit_cycle' | 'generic';
  content: string;
  count: number;
  timestamp: number;
  intervened: boolean;
}

export type OptimizationLevel = 'safe' | 'balanced' | 'aggressive';

// Patterns to detect agent actions in terminal output
// These cover common output formats for Claude Code and OpenCode
const FILE_READ_PATTERNS = [
  /(?:Read|Reading|Cat|View(?:ing)?)\s+(?:file:?\s*)?[`"']?([^\s`"'\n]+\.\w+)[`"']?/gi,
  /(?:cat|less|head|tail|bat)\s+([^\s|>\n]+\.\w+)/gi,
];

const COMMAND_EXEC_PATTERNS = [
  /(?:Running|Executing|Exec|Run|bash|shell|command)[:>]?\s*[`"']?(.+?)[`"']?\s*$/gim,
  /\$\s+(.+)$/gim,
  /(?:❯|›|>)\s+(.+)$/gim,
];

const ERROR_PATTERNS = [
  /(?:error|Error|ERROR|FAIL|fail|Failed|FAILED)[:\s]+(.+)/gi,
  /(?:✗|✖|×)\s+(.+)/gi,
];

const EDIT_PATTERNS = [
  /(?:Edit(?:ing|ed)?|Writ(?:e|ing|ten)|Updat(?:e|ing|ed)|Modif(?:y|ying|ied))\s+(?:file:?\s*)?[`"']?([^\s`"'\n]+\.\w+)[`"']?/gi,
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
    aggressive: 2, // Flag after 2 repeats
  };

  private level: OptimizationLevel;

  constructor(level: OptimizationLevel = 'balanced') {
    this.level = level;
  }

  /**
   * Analyze a chunk of agent output for loop patterns.
   * Returns any newly detected loop events.
   */
  analyzeOutput(output: string): LoopEvent[] {
    const newEvents: LoopEvent[] = [];
    const threshold = this.thresholds[this.level];

    // --- Detect file read loops ---
    for (const pattern of FILE_READ_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = this.normalizePath(match[1]);
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
      while ((match = pattern.exec(output)) !== null) {
        const cmd = match[1].trim();
        if (cmd.length < 3 || cmd.length > 200) continue; // Skip noise

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
      while ((match = pattern.exec(output)) !== null) {
        const error = match[1].trim().substring(0, 100); // Cap length
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
      while ((match = pattern.exec(output)) !== null) {
        const file = this.normalizePath(match[1]);
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
   * If the same block of text (>50 chars) appears repeatedly,
   * that's a generic loop.
   */
  analyzeGenericRepetition(output: string): LoopEvent[] {
    const newEvents: LoopEvent[] = [];
    const threshold = this.thresholds[this.level];

    // Split into meaningful chunks (paragraphs)
    const chunks = output.split(/\n{2,}/).filter(c => c.trim().length > 50);

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
   * Get a nudge message for the agent based on the loop type.
   */
  getNudgeMessage(event: LoopEvent): string {
    switch (event.type) {
      case 'file_read':
        return `[SmartCode] You've already read "${event.content}" ${event.count} times this session. The content hasn't changed since your last read. Please proceed with the information you already have.\n`;
      case 'command_exec':
        return `[SmartCode] The command "${event.content}" has been executed ${event.count} times with the same result. Try a different approach.\n`;
      case 'error_repeat':
        return `[SmartCode] This error has occurred ${event.count} times: "${event.content}". The same approach is failing repeatedly. Try an alternative solution.\n`;
      case 'edit_cycle':
        return `[SmartCode] File "${event.content}" has been edited ${event.count} times. You may be in an edit-revert cycle. Step back and reconsider your approach.\n`;
      case 'generic':
        return `[SmartCode] Repeated pattern detected (${event.count}x). Consider a different approach.\n`;
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
    // Normalize whitespace and lowercase for comparison
    return cmd.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private hashChunk(text: string): string {
    // Simple hash: first 20 chars + length + last 20 chars
    const trimmed = text.replace(/\s+/g, ' ').toLowerCase();
    return `${trimmed.substring(0, 20)}:${trimmed.length}:${trimmed.substring(trimmed.length - 20)}`;
  }

  /**
   * Determine if a pattern should be reported at this count.
   * Reports at threshold, then at exponentially increasing intervals
   * (2x, 4x, 8x threshold) to avoid spamming events.
   */
  private shouldReport(type: string, key: string, count: number, threshold: number): boolean {
    const reportKey = `${type}:${key}:${count}`;
    if (this.reportedPatterns.has(reportKey)) return false;

    // Report at threshold, then at 2x, 4x, 8x, etc.
    let reportAt = threshold;
    while (reportAt < count) {
      reportAt *= 2;
    }
    if (count !== reportAt && count !== threshold) return false;

    this.reportedPatterns.add(reportKey);
    return true;
  }
}
