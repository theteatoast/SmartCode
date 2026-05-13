import { PromptInjector } from '../core/prompt-injector.js';
/**
 * Base agent class.
 *
 * Agents no longer use child_process.spawn with stdio: 'inherit'.
 * Instead, they go through the PTY manager for full I/O interception.
 */
export class BaseAgent {
    config;
    promptInjector;
    constructor(config) {
        this.config = config;
        this.promptInjector = new PromptInjector(config.responseStyle);
    }
    /**
     * Launch the agent via the PTY manager.
     * Returns the exit code.
     */
    async execute(ptyManager) {
        const { command, args, env } = this.getLaunchCommand();
        return ptyManager.spawn({
            command,
            args,
            env,
            cwd: process.cwd(),
        });
    }
}
