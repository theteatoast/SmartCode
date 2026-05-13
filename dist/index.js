#!/usr/bin/env node
import { select } from '@inquirer/prompts';
import { Command } from 'commander';
import { SmartCodeRuntime } from './core/runtime.js';
const program = new Command();
program
    .name('smartcode')
    .description('The runtime layer for efficient AI coding.')
    .version('1.0.0');
program.action(async () => {
    console.log('\n⚡ SMARTCODE\n');
    try {
        const agent = await select({
            message: 'Select agent:',
            choices: [
                { name: 'Claude Code', value: 'claude' },
                { name: 'OpenCode', value: 'opencode' },
            ],
        });
        const optimizationLevel = await select({
            message: 'Optimization Level:',
            choices: [
                { name: 'Safe (track only, no intervention)', value: 'safe' },
                { name: 'Balanced (warn on loops)', value: 'balanced' },
                { name: 'Aggressive (auto-intervene on loops)', value: 'aggressive' },
            ],
        });
        const responseStyle = await select({
            message: 'Response Style:',
            choices: [
                { name: 'Normal (no modification)', value: 'normal' },
                { name: 'Concise (minimal explanations)', value: 'concise' },
                { name: 'Patch-only (code changes only)', value: 'patch_only' },
                { name: 'Commands-only (shell commands only)', value: 'commands_only' },
            ],
        });
        const displayName = agent === 'claude' ? 'Claude Code' : 'OpenCode';
        console.log(`\nLaunching ${displayName} (optimized)...\n`);
        const config = {
            name: agent,
            optimizationLevel: optimizationLevel,
            responseStyle: responseStyle,
        };
        const runtime = new SmartCodeRuntime(config);
        await runtime.runSession();
    }
    catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
            console.log('\nExiting SmartCode.');
        }
        else {
            console.error('\nAn error occurred:', error);
        }
        process.exit(1);
    }
});
program.parse(process.argv);
