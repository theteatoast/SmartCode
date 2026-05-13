/**
 * Prompt injector — enforces response style by injecting system prompt
 * rules into the agent's launch configuration.
 * 
 * Claude Code: uses --append-system-prompt flag
 * OpenCode: uses OPENCODE_CONFIG_CONTENT env var
 */

export type ResponseStyle = 'normal' | 'concise' | 'patch_only' | 'commands_only';

const STYLE_PROMPTS: Record<ResponseStyle, string> = {
  normal: '',
  concise: [
    'IMPORTANT RULES FOR THIS SESSION:',
    '- Be extremely concise in all responses.',
    '- Do NOT explain what you are doing unless explicitly asked.',
    '- Do NOT add commentary before or after code changes.',
    '- Show only the minimal necessary output.',
    '- Prefer showing diffs/patches over full file contents.',
    '- Skip greetings, summaries, and sign-offs.',
  ].join('\n'),
  patch_only: [
    'CRITICAL RULES FOR THIS SESSION:',
    '- Respond ONLY with code diffs, patches, or file edits.',
    '- Do NOT include any prose, explanation, or commentary.',
    '- Do NOT describe what the patch does.',
    '- Do NOT add any text before or after the code changes.',
    '- If asked a question, answer in one sentence maximum, then show the code.',
  ].join('\n'),
  commands_only: [
    'CRITICAL RULES FOR THIS SESSION:',
    '- Respond ONLY with shell commands or code.',
    '- Do NOT explain what commands do.',
    '- Do NOT add commentary or reasoning.',
    '- Use one-liners where possible.',
    '- Chain commands with && when appropriate.',
    '- If a question requires explanation, answer in one sentence maximum.',
  ].join('\n'),
};

export interface AgentLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export class PromptInjector {
  private style: ResponseStyle;

  constructor(style: ResponseStyle) {
    this.style = style;
  }

  /**
   * Get the system prompt text for the current response style.
   */
  getPromptText(): string {
    return STYLE_PROMPTS[this.style];
  }

  /**
   * Build launch configuration for Claude Code with response style injected.
   */
  buildClaudeConfig(): AgentLaunchConfig {
    const args: string[] = [];
    const env: Record<string, string> = {};

    const prompt = STYLE_PROMPTS[this.style];
    if (prompt) {
      args.push('--append-system-prompt', prompt);
    }

    return { command: 'claude', args, env };
  }

  /**
   * Build launch configuration for OpenCode with response style injected.
   */
  buildOpenCodeConfig(): AgentLaunchConfig {
    const args: string[] = [];
    const env: Record<string, string> = {};

    const prompt = STYLE_PROMPTS[this.style];
    if (prompt) {
      // OpenCode supports inline config via environment variable
      // We use the agent system to inject custom instructions
      env['OPENCODE_SYSTEM_PROMPT'] = prompt;
    }

    return { command: 'opencode', args, env };
  }

  /**
   * Build launch config for any supported agent.
   */
  buildConfig(agentName: string): AgentLaunchConfig {
    switch (agentName) {
      case 'claude':
        return this.buildClaudeConfig();
      case 'opencode':
        return this.buildOpenCodeConfig();
      default:
        return { command: agentName, args: [], env: {} };
    }
  }
}
