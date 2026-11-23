#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readActivity } from './activity.js';
import { readConfig } from './config.js';
import { gitStatus } from './git.js';
import { render } from './render.js';
import { install, printSettings, uninstall } from './setup.js';
import { normalizeState } from './state.js';

const help = `Usage: agy-hub [command]

With no command, render Antigravity CLI statusline JSON from stdin.

  preview [--compact] [--activity] [--width <columns>] [--plain]
             Render a sample session without running agy.
  settings   Print a JSON override for agy --settings.
  install    Set the HUD as the statusline for new agy sessions.
  uninstall  Restore the previous statusline settings.
  --help     Show this help.
`;

const colorEnabled = () => !process.env.NO_COLOR;
const write = (output) => { if (output) process.stdout.write(`${output}\n`); };

async function fromStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024 * 1024) return;
  }
  let payload;
  try { payload = JSON.parse(input); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const config = readConfig();
  const state = normalizeState(payload);
  const git = config.gitStatus.enabled ? gitStatus(state.cwd, config.gitStatus, state.vcs) : null;
  const activity = config.display.showTools ? readActivity(state) : null;
  write(render(state, config, { git, activity, color: colorEnabled() }));
}

function preview(args) {
  const { values } = parseArgs({ args, options: {
    compact: { type: 'boolean' }, activity: { type: 'boolean' },
    width: { type: 'string' }, plain: { type: 'boolean' },
  } });
  const width = values.width === undefined ? 110 : Number(values.width);
  if (!Number.isInteger(width) || width < 1) throw new Error('--width expects a positive integer.');
  const config = readConfig();
  if (values.compact) config.lineLayout = 'compact';
  if (values.activity) {
    config.display.showTools = true;
    config.display.showAgents = true;
  }
  const state = normalizeState({
    cwd: '/workspace/my-project', model: { display_name: 'Gemini 3.8 Flash' },
    context_window: { used_percentage: 45 }, terminal_width: width,
    quota: { 'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5400 } },
    subagents: [{ name: 'explore', model: 'Gemini Flash', status: 'running', role: 'Finding auth code' }],
  });
  write(render(state, config, {
    color: !values.plain && colorEnabled(), git: { branch: 'main', dirty: true },
    activity: { running: [{ name: 'Edit', target: 'auth.ts' }], completed: [{ name: 'Read', count: 3 }, { name: 'Grep', count: 2 }] },
  }));
}

async function main([command, ...args]) {
  if (!command) return await fromStdin();
  if (command === 'preview') return preview(args);
  if (command === '--help' || command === '-h') return process.stdout.write(help);
  if (args.length) throw new Error(`Unexpected argument: ${args[0]}`);
  if (command === 'settings') return write(printSettings());
  if (command === 'install') return write(await install());
  if (command === 'uninstall') return write(await uninstall());
  throw new Error(`Unknown command: ${command}. Run agy-hub --help.`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`agy-hub: ${error.message}\n`);
  process.exitCode = 1;
}
