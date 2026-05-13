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

  public async runSession(): Promise<void> {
    console.log(`[SmartCode] Session: ${this.sessionId}`);
    console.log(`[SmartCode] Agent: ${this.config.name} | Level: ${this.config.optimizationLevel} | Style: ${this.config.responseStyle}`);

    if (this.config.responseStyle !== 'normal') {
      console.log(`[SmartCode] Response style "${this.config.responseStyle}" will be enforced via system prompt injection.`);
    }

    console.log(`[SmartCode] Loop detection active (threshold: ${this.config.optimizationLevel}).`);
    console.log(`[SmartCode] Handing over control to ${this.config.name}...`);
    console.log(`────────────────────────────────────────────────────────\n`);

    // Record session in DB
    this.sessionManager.createSession(
      this.sessionId,
      this.config.name,
      this.config.optimizationLevel,
      this.config.responseStyle
    );

    // --- Wire up event handlers ---

    // Track agent output for analytics and loop detection
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
      // Each user input is an interaction
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
   */
  private handleLoopEvent(event: LoopEvent): void {
    switch (this.config.optimizationLevel) {
      case 'aggressive':
        // Inject a nudge message into the agent's stdin
        const nudge = this.loopDetector.getNudgeMessage(event);
        this.ptyManager.write(nudge);
        this.loopDetector.markIntervened(event);
        this.analytics.recordWastedBytes(event.content.length * event.count);
        break;

      case 'balanced':
        // Show a warning to the user (but don't inject into agent)
        // We write directly to process.stderr to avoid it being captured as agent output
        process.stderr.write(`\n⚠️  [SmartCode] ${this.loopDetector.getNudgeMessage(event)}`);
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
