#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { normalizeConfig, readConfig } from './config.js';
import { hookDefinitions, recordHook } from './hooks.js';
import { samplePreview } from './preview.js';
import { render } from './render.js';
import { recordedPreview } from './replay.js';
import { presetConfig, presetNames } from './presets.js';
import { readInput } from './runtime/input.js';
import { install, printSettings, uninstall } from './setup.js';

const help = `Usage: agy-hud [command]

With no command, render Antigravity CLI statusline JSON from stdin.

  setup [--configure-only] [--preset <name>] [--prompt-language <language>]
             Pick a layout, preview it and apply it in the terminal.
             Prompt languages: en (default), zh-Hans, zh-Hant.
             Use --dry-run or --yes for agents, with --set '<JSON patch>'.
  preview [--preset <name>] [--set '<JSON patch>'] [--last] [--width <columns>] [--plain]
             Render a sample or replay an opt-in recorded frame.
  init [--preset <name>]
             Create a configuration without overwriting an existing file.
  config <show|check|path|set|undo|schema>
             Read, validate, update or restore HUD settings.
  schema [--json-schema]
             Print settings or the editor JSON Schema.
  doctor     Check configuration, integration and any recorded frame.
  report     Print diagnostic metadata without paths or account information.
  hooks      Print optional Antigravity lifecycle hook definitions.
  skill <install|uninstall|path>
             Manage the local /agy-hud skill for Antigravity CLI.
  --extra-cmd '<command>'
             Add its first line to the HUD when AGY_HUD_ALLOW_EXTRA_CMD=1.
  settings   Print a JSON override for agy --settings.
  install    Set the HUD as the statusline for new agy sessions.
  uninstall  Restore the previous statusline settings.
  --help     Show this help.

Presets: ${presetNames.join(', ')}
`;

const colorEnabled = () => !process.env.NO_COLOR;
const write = (output) => { if (output) process.stdout.write(`${output}\n`); };

async function preview(args) {
  const { values } = parseArgs({ args, options: {
    compact: { type: 'boolean' }, activity: { type: 'boolean' },
    width: { type: 'string' }, plain: { type: 'boolean' }, last: { type: 'boolean' },
    preset: { type: 'string' }, set: { type: 'string' },
  } });
  const width = values.width === undefined ? 110 : Number(values.width);
  if (!Number.isInteger(width) || width < 1) throw new Error('--width expects a positive integer.');
  const preset = values.preset === undefined ? undefined : presetConfig(values.preset);
  let config = preset ? normalizeConfig(preset) : readConfig();
  if (values.set !== undefined) {
    const { parseConfigPatch, previewPreferences } = await import('./preferences.js');
    config = previewPreferences(parseConfigPatch(values.set), { base: preset }).config;
  }
  if (values.compact) config.lineLayout = 'compact';
  if (values.activity) {
    config.display.showTools = true;
    config.display.showAgents = true;
  }
  if (values.last) {
    const last = recordedPreview();
    const missing = 'No usable recorded frame. Enable display.recordPreview and open an agy session.';
    if (!last) throw new Error(missing);
    if (values.width !== undefined) last.state.width = width;
    try {
      write(render(last.state, config, { ...last.details, color: !values.plain && colorEnabled() }));
    } catch {
      throw new Error(missing);
    }
    return;
  }
  write(samplePreview(config, { width, color: !values.plain && colorEnabled() }));
}

async function configure(command, args) {
  const { preferences } = await import('./preferences.js');
  const [action, ...rest] = command === 'config' ? args.length ? args : ['show'] : [command, ...args];
  if (action === 'init') {
    const { values } = parseArgs({ args: rest, options: { preset: { type: 'string' } } });
    const { created, path } = JSON.parse(preferences('init', values.preset));
    return write(created ? `Created ${path}.` : `Configuration already exists at ${path}. Use agy-hud config set to update it.`);
  }
  if (action === 'schema' && rest.length === 1 && rest[0] === '--json-schema') return write(preferences('json-schema'));
  if (action === 'set' && rest.length === 1) return write(preferences('set', rest[0]));
  if (rest.length || !['show', 'check', 'path', 'undo', 'schema'].includes(action)) {
    throw new Error('Use agy-hud --help to see the config commands.');
  }
  const result = preferences(action);
  if (action === 'check' && !JSON.parse(result).valid) process.exitCode = 1;
  write(result);
}

async function main([command, ...args]) {
  if (!command || (command === '--extra-cmd' && args.length === 1)) {
    const { statusline } = await import('./runtime/statusline.js');
    return write(await statusline(args[0]));
  }
  if (command === 'preview') return preview(args);
  if (command === 'setup') {
    const { runSetup } = await import('./setup-command.js');
    return write(await runSetup(args));
  }
  if (command === 'skill' && args.length === 1) {
    const { manageSkill } = await import('./skill.js');
    return write(await manageSkill(args[0]));
  }
  if (command === '--help' || command === '-h') return process.stdout.write(help);
  if (['init', 'config', 'schema', 'set', 'undo'].includes(command)) return configure(command, args);
  if (command === 'hook' && args.length === 1) {
    recordHook(args[0], await readInput());
    // "allow" passes the decision to the next hook or agy's existing policy.
    return write(args[0] === 'PreToolUse' ? '{"decision":"allow"}' : '{}');
  }
  if (args.length) throw new Error(`Unexpected argument: ${args[0]}`);
  if (command === 'doctor' || command === 'report') {
    const { diagnostics } = await import('./diagnostics.js');
    return write(JSON.stringify(await diagnostics(command === 'report'), null, 2));
  }
  if (command === 'hooks') return write(JSON.stringify(hookDefinitions(), null, 2));
  if (command === 'settings') return write(printSettings());
  if (command === 'install') return write(await install());
  if (command === 'uninstall') return write(await uninstall());
  throw new Error(`Unknown command: ${command}. Run agy-hud --help.`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`agy-hud: ${error.message}\n`);
  process.exitCode = 1;
}
