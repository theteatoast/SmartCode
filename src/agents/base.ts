export interface AgentConfig {
  name: string;
  optimizationLevel: 'safe' | 'balanced' | 'aggressive';
  responseStyle: 'normal' | 'concise' | 'patch_only' | 'commands_only';
}

export abstract class BaseAgent {
  protected config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  abstract execute(prompt: string): Promise<string>;
}
