import { BaseAgent } from './base.js';
export class ClaudeAgent extends BaseAgent {
    constructor(config) {
        super(config);
    }
    getLaunchCommand() {
        const launchConfig = this.promptInjector.buildClaudeConfig();
        return {
            command: launchConfig.command,
            args: launchConfig.args,
            env: launchConfig.env,
        };
    }
}
