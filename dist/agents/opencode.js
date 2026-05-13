import { BaseAgent } from './base.js';
export class OpenCodeAgent extends BaseAgent {
    constructor(config) {
        super(config);
    }
    getLaunchCommand() {
        const launchConfig = this.promptInjector.buildOpenCodeConfig();
        return {
            command: launchConfig.command,
            args: launchConfig.args,
            env: launchConfig.env,
        };
    }
}
