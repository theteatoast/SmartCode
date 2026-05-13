import { spawn } from 'child_process';
import { BaseAgent, AgentConfig } from './base.js';

export class ClaudeAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
  }

  async execute(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      // Launch claude interactively.
      // If no prompt is provided, it opens the interactive shell.
      const args = prompt ? ['-p', prompt] : [];
      
      const child = spawn('claude', args, {
        stdio: 'inherit',
        shell: true,
      });

      child.on('error', (err) => {
        console.error(`[Claude Error] Failed to start claude: ${err.message}`);
        resolve(`[Error] ${err.message}`);
      });

      child.on('close', (code) => {
        resolve(`Execution completed.`);
      });
    });
  }
}
