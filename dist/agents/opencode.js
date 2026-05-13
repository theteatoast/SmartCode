import { spawn } from 'child_process';
import { BaseAgent } from './base.js';
export class OpenCodeAgent extends BaseAgent {
    constructor(config) {
        super(config);
    }
    async execute(prompt) {
        return new Promise((resolve) => {
            // Launch opencode interactively. 
            // If no prompt is provided, it opens the interactive shell.
            const args = prompt ? [prompt] : [];
            const child = spawn('opencode', args, {
                stdio: 'inherit',
                shell: true,
            });
            child.on('error', (err) => {
                console.error(`[OpenCode Error] Failed to start opencode: ${err.message}`);
                resolve(`[Error] ${err.message}`);
            });
            child.on('close', (code) => {
                resolve(`Execution completed.`);
            });
        });
    }
}
