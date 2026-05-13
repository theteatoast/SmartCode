#!/usr/bin/env node
import { select } from '@inquirer/prompts';
import { Command } from 'commander';
import { SmartCodeRuntime } from './core/runtime.js';
import { AgentConfig } from './agents/base.js';

const program = new Command();

program
  .name('smartcode')
  .description('The runtime layer for efficient AI coding.')
  .version('1.0.0');

program.action(async () => {
  console.log('\nSMARTCODE\n');

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
        { name: 'Safe', value: 'safe' },
        { name: 'Balanced', value: 'balanced' },
        { name: 'Aggressive', value: 'aggressive' },
      ],
    });

    const responseStyle = await select({
      message: 'Response Style:',
      choices: [
        { name: 'Normal', value: 'normal' },
        { name: 'Concise', value: 'concise' },
        { name: 'Patch-only', value: 'patch_only' },
        { name: 'Commands-only', value: 'commands_only' },
      ],
    });

    console.log(`\nLaunching ${agent === 'claude' ? 'Claude Code' : 'OpenCode'} (optimized)...\n`);
    
    const config: AgentConfig = {
      name: agent,
      optimizationLevel: optimizationLevel as AgentConfig['optimizationLevel'],
      responseStyle: responseStyle as AgentConfig['responseStyle'],
    };

    const runtime = new SmartCodeRuntime(config);
    await runtime.runSession();

  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') {
      console.log('\nExiting SmartCode.');
    } else {
      console.error('\nAn error occurred:', error);
    }
    process.exit(1);
  }
});

program.parse(process.argv);
