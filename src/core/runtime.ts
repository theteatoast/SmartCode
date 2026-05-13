/**
 * SmartCode Runtime — the main orchestrator.
 * 
 * Wires together all production systems:
 * - PTY Manager: transparent I/O interception
 * - Loop Detector: real-time pattern analysis
 * - Analytics: actual metric tracking
 * - Session Manager: persistence
 * - Cache Manager: semantic caching
 * 
 * No hardcoded values. Every metric comes from real observations.
 */

import { execSync } from 'child_process';
import os from 'os';
import { PtyManager, PtyDataEvent } from './pty-manager.js';
import { LoopDetector, LoopEvent, OptimizationLevel } from './loop-detector.js';
import { Analytics } from './analytics.js';
import { CacheManager } from '../db/cache.js';
import { SessionManager } from '../db/session.js';
import { BaseAgent, AgentConfig } from '../agents/base.js';
import { ClaudeAgent } from '../agents/claude.js';
import { OpenCodeAgent } from '../agents/opencode.js';

export class SmartCodeRuntime {
  private agent: BaseAgent;
  private config: AgentConfig;
  private ptyManager: PtyManager;
  private loopDetector: LoopDetector;
  private analytics: Analytics;
  private sessionManager: SessionManager;
  private cache: CacheManager;
  private sessionId: string;

  constructor(config: AgentConfig) {
    this.config = config;

    // Initialize all systems
    this.sessionManager = new SessionManager();
    this.sessionId = this.sessionManager.generateSessionId();
    this.cache = new CacheManager();
    this.ptyManager = new PtyManager();
    this.loopDetector = new LoopDetector(config.optimizationLevel as OptimizationLevel);
    this.analytics = new Analytics(
      this.sessionId,
      config.name,
      config.optimizationLevel,
      config.responseStyle
    );

    // Create the appropriate agent
    if (config.name === 'claude') {
      this.agent = new ClaudeAgent(config);
    } else {
      this.agent = new OpenCodeAgent(config);
    }
  }

  /**
   * Verify the selected agent is installed and accessible on PATH.
   */
  private verifyAgentInstalled(): boolean {
    const command = this.config.name === 'claude' ? 'claude' : 'opencode';
    const checker = os.platform() === 'win32' ? 'where' : 'which';

    try {
      execSync(`${checker} ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public async runSession(): Promise<void> {
    // --- Pre-flight: verify agent is installed ---
    if (!this.verifyAgentInstalled()) {
      const agentDisplay = this.config.name === 'claude' ? 'Claude Code' : 'OpenCode';
      const installHint = this.config.name === 'claude'
        ? 'npm install -g @anthropic-ai/claude-code'
        : 'See https://opencode.ai for installation instructions';

      console.error(`\n❌ ${agentDisplay} is not installed or not found on PATH.`);
      console.error(`   Install it first: ${installHint}`);
      console.error(`   Then run smartcode again.\n`);
      return;
    }

    console.log(`[SmartCode] Session: ${this.sessionId}`);
    console.log(`[SmartCode] Agent: ${this.config.name} | Level: ${this.config.optimizationLevel} | Style: ${this.config.responseStyle}`);

    if (this.config.responseStyle !== 'normal') {
      console.log(`[SmartCode] Response style "${this.config.responseStyle}" enforced via system prompt.`);
    }

    console.log(`[SmartCode] Loop detection active (${this.config.optimizationLevel}).`);
    console.log(`[SmartCode] Handing over to ${this.config.name}...`);
    console.log(`────────────────────────────────────────────────────────\n`);

    // Record session in DB
    this.sessionManager.createSession(
      this.sessionId,
      this.config.name,
      this.config.optimizationLevel,
      this.config.responseStyle
    );

    // --- Wire up event handlers ---

    // Track agent output for analytics
    this.ptyManager.on('data', (event: PtyDataEvent) => {
      this.analytics.recordAgentOutput(event.raw.length);
    });

    // Analyze complete agent turns for loop patterns
    this.ptyManager.on('agent-turn', (output: string) => {
      const loopEvents = this.loopDetector.analyzeOutput(output);
      const genericEvents = this.loopDetector.analyzeGenericRepetition(output);
      const allEvents = [...loopEvents, ...genericEvents];

      for (const event of allEvents) {
        this.analytics.recordLoopEvent(event);
        this.handleLoopEvent(event);
      }
    });

    // Track user input for analytics
    this.ptyManager.on('user-input', (input: string) => {
      this.analytics.recordUserInput(input.length);
      if (input.includes('\r') || input.includes('\n')) {
        this.analytics.recordInteraction();
      }
    });

    // --- Launch the agent ---
    try {
      await this.agent.execute(this.ptyManager);
    } catch (err) {
      console.error(`\n[SmartCode Error] Agent failed:`, err);
    }

    // --- Session complete ---
    console.log(`\n────────────────────────────────────────────────────────`);

    // Save and display analytics
    const metrics = this.analytics.getMetrics();
    this.sessionManager.saveMetrics(metrics);
    this.analytics.printSummary();

    // Show lifetime stats
    this.printLifetimeStats();

    // Cleanup
    this.sessionManager.close();
    this.cache.close();
  }

  /**
   * Handle a detected loop event based on optimization level.
   * 
   * IMPORTANT: We NEVER inject text into the agent's stdin.
   * Both Claude Code and OpenCode use interactive TUI frameworks.
   * Injecting raw text into their stdin would be interpreted as
   * random keystrokes, breaking the TUI rendering.
   * 
   * Instead, all levels display warnings via stderr (visible to the
   * user but not captured by the agent). The difference between levels
   * is how prominently and how early warnings appear.
   */
  private handleLoopEvent(event: LoopEvent): void {
    const message = this.loopDetector.getNudgeMessage(event);

    switch (this.config.optimizationLevel) {
      case 'aggressive':
        // Prominent warning with bell character to draw attention
        process.stderr.write(`\n\x07⚠️  [SmartCode] ${message}\n`);
        this.loopDetector.markIntervened(event);
        this.analytics.recordWastedBytes(event.content.length * event.count);
        break;

      case 'balanced':
        // Quieter warning
        process.stderr.write(`\n⚠️  [SmartCode] ${message}\n`);
        break;

      case 'safe':
        // Silent tracking only — no user-visible action
        break;
    }
  }

  /**
   * Print aggregate stats across all sessions.
   */
  private printLifetimeStats(): void {
    try {
      const stats = this.sessionManager.getAggregateStats();
      if (stats.totalSessions > 1) {
        console.log(`Lifetime Stats (${stats.totalSessions} sessions)`);
        console.log(`───────────────`);
        console.log(`Total Loops Detected: ${stats.totalLoopsDetected}`);
        console.log(`Total Loops Intervened: ${stats.totalLoopsIntervened}`);
        console.log(`Avg Efficiency Gain: +${stats.avgEfficiencyGain}%`);
        console.log('');
      }
    } catch {
      // Non-critical — don't break the flow
    }
  }
}
