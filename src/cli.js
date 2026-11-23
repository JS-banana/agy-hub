#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { readActivity } from './activity.js';
import { readConfig } from './config.js';
import { gitStatus } from './git.js';
import { hookActivity, hookDefinitions, recordHook } from './hooks.js';
import { configCounts, externalQuota, memoryUsage, recordCosts } from './local-data.js';
import { render } from './render.js';
import { diagnostics, recordedPreview, recordPreview } from './replay.js';
import { install, printSettings, uninstall } from './setup.js';
import { normalizeState } from './state.js';
import { labelText } from './terminal.js';

const help = `Usage: agy-hub [command]

With no command, render Antigravity CLI statusline JSON from stdin.

  preview [--last] [--compact] [--activity] [--width <columns>] [--plain]
             Render a sample or replay an opt-in recorded frame.
  config     Print the effective HUD configuration.
  schema     List the supported settings and their defaults.
  set '<JSON object>'
             Change HUD settings and save the previous configuration.
  undo       Restore the previous HUD configuration.
  doctor     Check configuration, integration and any recorded frame.
  report     Print diagnostic metadata without paths or account information.
  hooks      Print optional Antigravity lifecycle hook definitions.
  --extra-cmd '<command>'
             Add its first line to the HUD when AGY_HUB_ALLOW_EXTRA_CMD=1.
  settings   Print a JSON override for agy --settings.
  install    Set the HUD as the statusline for new agy sessions.
  uninstall  Restore the previous statusline settings.
  --help     Show this help.
`;

const colorEnabled = () => !process.env.NO_COLOR;
const write = (output) => { if (output) process.stdout.write(`${output}\n`); };

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024 * 1024) return;
  }
  let payload;
  try { payload = JSON.parse(input); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  return payload;
}

function extraLabel(command) {
  if (!command || process.env.AGY_HUB_ALLOW_EXTRA_CMD !== '1' || process.platform === 'win32') return '';
  try {
    return labelText(execFileSync('/bin/sh', ['-c', command], {
      timeout: 300, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n', 1)[0]);
  } catch {
    return '';
  }
}

async function fromStdin(extraCommand) {
  if (process.env.AGY_HUB_DISABLE === '1') return;
  const payload = await readStdin();
  if (!payload) return;
  const config = readConfig();
  const state = normalizeState(payload);
  const git = config.gitStatus.enabled || config.jjStatus.enabled ? gitStatus(state.cwd, config.gitStatus, state.vcs, config.jjStatus) : null;
  const { display } = config;
  const transcript = display.showTools || display.showSkills || display.showMcp || display.showDuration
    || display.showSessionStartDate || display.showLastResponseAt || display.showSpeed || display.modelSource !== 'stdin'
    ? readActivity(state) : null;
  const activity = hookActivity(state, transcript, display);
  state.quota = externalQuota(state, display);
  const details = {
    git, activity, color: colorEnabled(), extra: extraLabel(extraCommand),
    memory: display.showMemoryUsage ? memoryUsage() : null,
    environment: display.showConfigCounts ? configCounts(state) : null,
    costTotals: display.showDailyCost || display.showWeeklyCost ? recordCosts(state, display) : null,
  };
  if (display.recordPreview) recordPreview(state, details);
  write(render(state, config, details));
}

function preview(args) {
  const { values } = parseArgs({ args, options: {
    compact: { type: 'boolean' }, activity: { type: 'boolean' },
    width: { type: 'string' }, plain: { type: 'boolean' }, last: { type: 'boolean' },
  } });
  const width = values.width === undefined ? 110 : Number(values.width);
  if (!Number.isInteger(width) || width < 1) throw new Error('--width expects a positive integer.');
  const config = readConfig();
  if (values.compact) config.lineLayout = 'compact';
  if (values.activity) {
    config.display.showTools = true;
    config.display.showAgents = true;
  }
  if (values.last) {
    const last = recordedPreview();
    if (!last) throw new Error('Enable display.recordPreview and start an agy session before using --last.');
    if (values.width !== undefined) last.state.width = width;
    write(render(last.state, config, { ...last.details, color: !values.plain && colorEnabled() }));
    return;
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
  if (command === '--extra-cmd' && args.length === 1) return await fromStdin(args[0]);
  if (command === 'set' && args.length === 1) {
    const { preferences } = await import('./preferences.js');
    return write(preferences('set', args[0]));
  }
  if (command === 'hook' && args.length === 1) {
    recordHook(args[0], await readStdin());
    // "allow" passes the decision to the next hook or agy's existing policy.
    return write(args[0] === 'PreToolUse' ? '{"decision":"allow"}' : '{}');
  }
  if (args.length) throw new Error(`Unexpected argument: ${args[0]}`);
  if (['schema', 'config', 'undo'].includes(command)) {
    const { preferences } = await import('./preferences.js');
    return write(preferences(command === 'config' ? 'show' : command));
  }
  if (command === 'doctor' || command === 'report') {
    const { preferences } = await import('./preferences.js');
    const statusline = process.platform === 'win32' ? undefined : JSON.parse(printSettings()).statusLine.command;
    const configuration = JSON.parse(preferences('check'));
    if (command === 'report') {
      for (const key of ['unknown', 'invalid', 'unsafe']) if (Array.isArray(configuration[key])) configuration[key] = configuration[key].length;
    }
    return write(JSON.stringify(diagnostics(statusline, configuration), null, 2));
  }
  if (command === 'hooks') return write(JSON.stringify(hookDefinitions(), null, 2));
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
