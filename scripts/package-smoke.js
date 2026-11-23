import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
const sandbox = mkdtempSync(join(tmpdir(), 'agy-hub-package-'));
const home = join(sandbox, 'home');
const stateDirectory = join(home, '.gemini', 'antigravity-cli');
const settingsPath = join(stateDirectory, 'settings.json');
const configPath = join(stateDirectory, 'agy-hub.json');
const workspace = join(sandbox, 'private-smoke-workspace');
const npmUserConfig = join(sandbox, 'npm-user.conf');
const npmGlobalConfig = join(sandbox, 'npm-global.conf');
const archiveDir = join(sandbox, 'archive');

const env = {
  ...process.env,
  HOME: home,
  PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_CACHE_HOME: join(home, '.cache'),
  AGY_HUB_CONFIG: configPath,
  AGY_HUB_DATA_DIR: join(stateDirectory, 'agy-hub-data'),
  NO_COLOR: '1',
};
delete env.AGY_HUB_DISABLE;

function run(executable, args, { input, allowFailure = false, cwd = sandbox } = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${executable} ${args.join(' ')} exited with ${result.status ?? result.signal}\n${result.stderr || result.stdout}`);
  }
  return result;
}

const npmOptions = ['--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(sandbox, 'npm-cache'),
  '--userconfig', npmUserConfig, '--globalconfig', npmGlobalConfig];

function extractArchive(directory, archive) {
  mkdirSync(directory);
  run('tar', ['-xzf', archive, '-C', directory, '--strip-components=1']);
  return (args, options) => run(process.execPath, [join(directory, 'src', 'cli.js'), ...args], options);
}

function installedSkillCommand(cli, skill) {
  const contents = readFileSync(skill, 'utf8');
  assert.match(contents, /name: agy-hub/);
  const prefix = /^## Installed command\n\n    ([^\n]+)$/m.exec(contents)?.[1];
  assert.equal(prefix, JSON.parse(cli(['settings']).stdout).statusLine.command);
  return prefix;
}

function settings() {
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

try {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'The package must be tested on Node.js 22 or newer');
  assert.notEqual(process.platform, 'win32', 'The full install smoke test requires macOS or Linux');
  mkdirSync(stateDirectory, { recursive: true });
  mkdirSync(workspace);
  mkdirSync(archiveDir);
  writeFileSync(npmUserConfig, '');
  writeFileSync(npmGlobalConfig, '');

  const packedResult = JSON.parse(run('npm', ['pack', project, '--json', '--pack-destination', archiveDir, ...npmOptions]).stdout);
  // npm 12 keys its JSON report by package name; earlier versions return an array.
  const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult[manifest.name];
  assert.ok(packed, `npm pack must report the ${manifest.name} archive`);
  const packedPaths = new Set(packed.files.map(({ path }) => path));
  for (const path of [
    'README.md', 'README.zh.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE',
    'docs/configuration.md', 'docs/integration.md', 'docs/architecture.md', 'docs/assets/agy-hub-terminal-preview.png',
    'src/cli.js', 'skills/agy-hub/SKILL.md',
  ]) {
    assert.ok(packedPaths.has(path), `The release archive must contain ${path}`);
  }
  const archive = join(archiveDir, packed.filename);
  const firstDirectory = join(sandbox, "original user's install");
  const first = extractArchive(firstDirectory, archive);
  const preview = first(['preview', '--preset', 'activity', '--plain']).stdout;
  assert.match(preview, /Context .*Usage /);
  assert.match(preview, /✓ Read/);
  assert.match(preview, /◐ explore/);
  assert.ok(!existsSync(configPath), 'Preview should leave configuration untouched');

  first(['init', '--preset', 'activity']);
  assert.equal(JSON.parse(first(['config', 'check']).stdout).valid, true);
  const schema = JSON.parse(first(['schema', '--json-schema']).stdout);
  assert.match(schema.$schema, /2020-12/);
  assert.equal(schema.properties.display.properties.showTools.type, 'boolean');
  const initializedConfig = readFileSync(configPath, 'utf8');
  first(['init', '--preset', 'compact'], { allowFailure: true });
  assert.equal(readFileSync(configPath, 'utf8'), initializedConfig, 'Init must preserve an existing configuration');
  const plan = JSON.parse(first(['setup', '--dry-run', '--configure-only', '--preset', 'compact', '--json']).stdout);
  assert.match(plan.preview, /45% \| my-project/);
  assert.equal(readFileSync(configPath, 'utf8'), initializedConfig);
  const skill = first(['skill', 'path']).stdout.trim();
  first(['skill', 'install']);
  const originalSkill = installedSkillCommand(first, skill);
  const agentPlan = run('/bin/sh', ['-c', `${originalSkill} setup --dry-run --configure-only --preset compact --json`], { cwd: workspace });
  assert.equal(JSON.parse(agentPlan.stdout).preview, plan.preview);
  assert.ok(!existsSync(settingsPath), 'Registering or previewing through the skill should leave the statusline untouched');

  const previousSettings = {
    statusLine: { type: 'command', command: 'printf prior-hud', padding: 2, enabled: false },
    theme: 'original-theme',
  };
  writeFileSync(settingsPath, JSON.stringify(previousSettings));
  const replacement = run('/bin/sh', ['-c', `${originalSkill} setup --dry-run --json`], { cwd: workspace });
  assert.equal(JSON.parse(replacement.stdout).needsReplacement, true);
  run('/bin/sh', ['-c', `${originalSkill} setup --yes --replace`], { cwd: workspace });
  const oldCommand = settings().statusLine.command;
  assert.notEqual(oldCommand, previousSettings.statusLine.command);
  assert.equal(settings().theme, previousSettings.theme);
  assert.equal(JSON.parse(first(['doctor']).stdout).node, process.versions.node);

  first(['set', '{"display":{"recordPreview":true,"showAuthUser":true}}']);
  const input = JSON.stringify({
    cwd: workspace,
    model: { display_name: 'Gemini Smoke' },
    email: 'private-smoke-account@example.invalid',
    context_window: { used_percentage: 45 },
    terminal_width: 100,
    quota: { 'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5400 } },
    subagents: [{ name: 'smoke-helper', status: 'running' }],
  });
  const live = run('/bin/sh', ['-c', oldCommand], { input }).stdout;
  assert.match(live, /\[Gemini Smoke\]/);
  assert.match(live, /Context .*Usage /);
  assert.match(live, /◐ smoke-helper/);
  const replay = first(['preview', '--last', '--plain']).stdout;
  assert.match(replay, /\[Gemini Smoke\]/);
  assert.doesNotMatch(replay, /private-smoke-/);
  const report = first(['report']).stdout;
  assert.doesNotMatch(report, /private-smoke-|original-theme|printf prior-hud/);
  assert.equal(JSON.parse(report).capturedFrame.quota, true);

  const second = extractArchive(join(sandbox, 'replacement install'), archive);
  renameSync(firstDirectory, join(sandbox, 'retired install'));
  assert.notEqual(run('/bin/sh', ['-c', oldCommand], { input, allowFailure: true }).status, 0);
  const stale = JSON.parse(second(['doctor']).stdout);
  assert.equal(stale.configuration.valid, true);
  assert.equal(stale.statusline.state, 'broken');
  second(['install']);
  const newCommand = settings().statusLine.command;
  assert.notEqual(newCommand, oldCommand);
  assert.equal(JSON.parse(second(['doctor']).stdout).statusline.state, 'active');
  assert.match(run('/bin/sh', ['-c', newCommand], { input }).stdout, /\[Gemini Smoke\]/);
  second(['skill', 'install']);
  const reboundSkill = installedSkillCommand(second, skill);
  assert.notEqual(reboundSkill, originalSkill);
  assert.equal(reboundSkill, newCommand);
  assert.match(run('/bin/sh', ['-c', `${reboundSkill} preview --plain`], { cwd: workspace }).stdout, /Context/);
  second(['skill', 'uninstall']);
  assert.ok(!existsSync(skill));

  second(['uninstall']);
  assert.deepEqual(settings(), previousSettings, 'Uninstall must restore the pre-upgrade statusline and retain other settings');
  assert.ok(!existsSync(`${settingsPath}.agy-hub-backup.json`));
  console.log('Extracted package verified through preview, config, skill registration, install, replay, rebind and uninstall.');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
