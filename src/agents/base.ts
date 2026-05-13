import { PtyManager } from '../core/pty-manager.js';
import { PromptInjector, ResponseStyle } from '../core/prompt-injector.js';

export interface AgentConfig {
  name: string;
  optimizationLevel: 'safe' | 'balanced' | 'aggressive';
  responseStyle: ResponseStyle;
}

/**
 * Base agent class.
 * 
 * Agents no longer use child_process.spawn with stdio: 'inherit'.
 * Instead, they go through the PTY manager for full I/O interception.
 */
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected promptInjector: PromptInjector;

  constructor(config: AgentConfig) {
    this.config = config;
    this.promptInjector = new PromptInjector(config.responseStyle);
  }

  /**
   * Get the command and args to launch this agent.
   * Includes any system prompt injections for response style.
   */
  abstract getLaunchCommand(): { command: string; args: string[]; env: Record<string, string> };

  /**
   * Launch the agent via the PTY manager.
   * Returns the exit code.
   */
  async execute(ptyManager: PtyManager): Promise<number> {
    const { command, args, env } = this.getLaunchCommand();

    return ptyManager.spawn({
      command,
      args,
      env,
      cwd: process.cwd(),
    });
  }
}
