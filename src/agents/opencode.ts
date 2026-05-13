import { BaseAgent, AgentConfig } from './base.js';

export class OpenCodeAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
  }

  getLaunchCommand(): { command: string; args: string[]; env: Record<string, string> } {
    const launchConfig = this.promptInjector.buildOpenCodeConfig();

    return {
      command: launchConfig.command,
      args: launchConfig.args,
      env: launchConfig.env,
    };
  }
}
