import assert from 'node:assert/strict';
import { ChildProcess, execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { gitStatus, gitStatusAsync } from '../src/git.js';

const gitOptions = { showFileStats: true, showWorktree: true, showDirty: true };
const gitAvailable = spawnSync('git', ['--version']).status === 0;
const jjAvailable = spawnSync('jj', ['--version']).status === 0;

function temp(context) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agy-hud-vcs-')));
  context.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'core.autocrlf=false', '-c', 'user.name=AGY HUD Tests', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function init(cwd) {
  git(cwd, 'init', '--initial-branch=main', '--template=');
}

async function statusFromBoth(cwd, options, vcs, jjOptions) {
  const status = gitStatus(cwd, options, vcs, jjOptions);
  assert.deepEqual(await gitStatusAsync(cwd, options, vcs, jjOptions), status);
  return status;
}

test('a missing Git binary resolves to null and cancels the probe timeout', async (context) => {
  const cwd = temp(context);
  const emptyPath = temp(context);
  const env = process.env;
  context.after(() => { process.env = env; });
  process.env = { ...env, PATH: emptyPath };
  if (process.platform === 'win32') {
    // Even if an untrusted checkout contains git.exe, PATH resolution must ignore cwd.
    copyFileSync(process.execPath, join(cwd, 'git.exe'));
  }
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const kill = context.mock.method(ChildProcess.prototype, 'kill');

  assert.equal(await gitStatusAsync(cwd), null);
  assert.equal(gitStatus(cwd), null);
  context.mock.timers.runAll();
  assert.equal(kill.mock.callCount(), 0);
});

test('Git combines index and worktree stats, with rename, binary and nested untracked files', { skip: !gitAvailable }, async (context) => {
  const root = temp(context);
  init(root);
  mkdirSync(join(root, 'nested'));
  const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n') + '\n';
  writeFileSync(join(root, 'old name.txt'), before);
  writeFileSync(join(root, 'nested', 'edit.txt'), 'keep\nold\n');
  writeFileSync(join(root, 'delete.txt'), 'gone\n');
  writeFileSync(join(root, 'contents.bin'), Buffer.from([0, 1, 2]));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial');

  git(root, 'mv', 'old name.txt', 'new name.txt');
  writeFileSync(join(root, 'new name.txt'), before + 'g\n');
  writeFileSync(join(root, 'nested', 'edit.txt'), 'keep\nstaged\n');
  git(root, 'add', 'nested/edit.txt');
  writeFileSync(join(root, 'nested', 'edit.txt'), 'keep\nstaged\nunstaged\n');
  git(root, 'rm', 'delete.txt');
  const oddName = process.platform === 'win32' ? ' add (file).txt' : ' add\tfile.txt';
  writeFileSync(join(root, oddName), 'staged\n');
  git(root, 'add', oddName);
  writeFileSync(join(root, 'contents.bin'), Buffer.from([0, 1, 3]));
  mkdirSync(join(root, 'scratch'));
  writeFileSync(join(root, 'scratch', 'one'), '1');
  writeFileSync(join(root, 'scratch', 'two'), '2');

  const index = readFileSync(join(root, '.git', 'index'));
  const status = await statusFromBoth(join(root, 'nested'), gitOptions, 'git');
  assert.equal(status.root, root);
  assert.equal(status.branch, 'main');
  assert.equal(status.dirty, true);
  assert.equal(status.worktree, undefined);
  const { trackedFiles, ...counts } = status.fileStats;
  assert.deepEqual(counts, { modified: 3, added: 1, deleted: 1, untracked: 2 });
  assert.deepEqual(status.lineDiff, { added: 4, deleted: 2 });
  const files = new Map(trackedFiles.map((file) => [file.fullPath, file]));
  assert.deepEqual(files.get('new name.txt'), {
    basename: 'new name.txt', fullPath: 'new name.txt', type: 'modified', lineDiff: { added: 1, deleted: 0 },
  });
  assert.deepEqual(files.get('nested/edit.txt').lineDiff, { added: 2, deleted: 1 });
  assert.deepEqual(files.get(oddName).lineDiff, { added: 1, deleted: 0 });
  assert.equal(files.get('contents.bin').lineDiff, undefined);
  assert.equal(existsSync(join(root, '.git', 'index')), true);
  assert.deepEqual(readFileSync(join(root, '.git', 'index')), index);
});

test('Git caps listed files while keeping the complete counts in an unborn branch', { skip: !gitAvailable }, async (context) => {
  const root = temp(context);
  init(root);
  for (let index = 0; index < 9; index++) writeFileSync(join(root, `change-${index}`), 'new\n');
  git(root, 'add', '.');

  const status = await statusFromBoth(root, gitOptions);
  assert.equal(status.branch, 'main');
  assert.equal(status.fileStats.added, 9);
  assert.equal(status.fileStats.trackedFiles.length, 6);
  assert.deepEqual(status.fileStats.trackedFiles[0].lineDiff, { added: 1, deleted: 0 });
  assert.deepEqual(status.lineDiff, { added: 9, deleted: 0 });
});

test('Git counts commits on both sides of a diverged upstream branch', { skip: !gitAvailable }, async (context) => {
  const cwd = temp(context);
  init(cwd);
  git(cwd, 'commit', '--allow-empty', '-m', 'Base');
  git(cwd, 'checkout', '-b', 'upstream');
  git(cwd, 'commit', '--allow-empty', '-m', 'Upstream');
  git(cwd, 'checkout', 'main');
  git(cwd, 'branch', '--set-upstream-to=upstream');
  git(cwd, 'commit', '--allow-empty', '-m', 'Local');

  assert.deepEqual(await statusFromBoth(cwd, { showAheadBehind: true }),
    { branch: 'main', dirty: false, ahead: 1, behind: 1 });
});

test('Git falls back to the branch when status output exceeds its byte limit', { skip: !gitAvailable }, async (context) => {
  const cwd = temp(context);
  init(cwd);
  const blob = git(cwd, 'hash-object', '-w', '--stdin');
  const prefix = 'x'.repeat(200);
  const entries = Array.from({ length: 1400 }, (_, index) => `100644 ${blob}\t${prefix}${index}\n`).join('');
  execFileSync('git', ['-C', cwd, 'update-index', '--index-info'], { input: entries });

  assert.deepEqual(await statusFromBoth(cwd, gitOptions), { branch: 'main', dirty: false, ahead: 0, behind: 0 });
});

test('Git detects linked worktrees and names a detached head only for an exact tag', { skip: !gitAvailable }, async (context) => {
  const base = temp(context);
  const cwd = join(base, 'repo');
  const worktree = join(base, 'linked workspace');
  mkdirSync(cwd);
  init(cwd);
  git(cwd, 'commit', '--allow-empty', '-m', 'Release');
  git(cwd, 'tag', '-a', 'v1.0.0', '-m', 'release');
  git(cwd, 'commit', '--allow-empty', '-m', 'Next');
  git(cwd, 'worktree', 'add', '--detach', worktree, 'v1.0.0');

  assert.equal((await statusFromBoth(cwd, gitOptions)).worktree, undefined);
  const linked = await statusFromBoth(worktree, gitOptions);
  assert.equal(linked.worktree, basename(worktree));
  assert.equal(linked.branch, 'v1.0.0');
  assert.equal(linked.root, worktree);
  assert.equal((await statusFromBoth(worktree, {})).worktree, undefined);
  git(worktree, 'checkout', '--detach', 'main');
  assert.equal((await statusFromBoth(worktree, gitOptions)).branch, `detached:${git(cwd, 'rev-parse', 'HEAD').slice(0, 7)}`);
});

test('Git reads status with checkout-configured clean, diff and textconv drivers disabled', { skip: !gitAvailable }, async (context) => {
  const cwd = temp(context);
  init(cwd);
  writeFileSync(join(cwd, '.gitattributes'), 'note.txt filter=test diff=test\n');
  writeFileSync(join(cwd, 'note.txt'), 'baseline\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'Initial');
  git(cwd, 'config', 'filter.test.required', 'true');
  git(cwd, 'config', 'filter.test.clean', 'false');
  git(cwd, 'config', 'diff.test.command', 'false');
  git(cwd, 'config', 'diff.test.textconv', 'false');
  writeFileSync(join(cwd, 'note.txt'), 'baseline\nchanged\n');

  assert.deepEqual((await statusFromBoth(cwd, gitOptions)).lineDiff, { added: 1, deleted: 0 });
});

test('a jj checkout with local configuration falls back only to colocated Git', { skip: !gitAvailable }, async (context) => {
  const cwd = temp(context);
  const checkout = join(cwd, 'workspace');
  mkdirSync(join(checkout, '.jj', 'repo'), { recursive: true });
  writeFileSync(join(checkout, '.jj', 'repo', 'config.toml'), '[ui]\npager = "none"\n');
  init(cwd);
  assert.equal(await statusFromBoth(checkout, {}, 'jj', { enabled: true }), null);
  init(checkout);
  assert.deepEqual(await statusFromBoth(checkout, {}, 'jj', { enabled: true }), { branch: 'main', dirty: false, ahead: 0, behind: 0 });
});

test('Jujutsu shows a bookmark, recorded changes and conflicts without snapshotting the working copy', { skip: !jjAvailable }, async (context) => {
  const cwd = temp(context);
  const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'AGY HUD Tests', JJ_EMAIL: 'test@example.invalid', XDG_CONFIG_HOME: cwd };
  const jj = (...args) => execFileSync('jj', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  jj('git', 'init', '--no-colocate');
  const status = () => statusFromBoth(cwd, { enabled: false }, 'jj', { enabled: true });

  const initial = await status();
  assert.match(initial.branch, /^[a-z]{8,}$/);
  assert.equal(initial.dirty, false);
  writeFileSync(join(cwd, 'tracked.txt'), 'base\n');
  assert.equal((await status()).dirty, false);
  jj('bookmark', 'create', 'hud-bookmark', '-r', '@');
  assert.deepEqual(await status(), { branch: 'hud-bookmark', dirty: true, ahead: 0, behind: 0, vcs: 'jj', conflict: false });
  jj('new', '@');
  writeFileSync(join(cwd, 'tracked.txt'), 'left\n');
  const left = jj('log', '-r', '@', '--no-graph', '-T', 'change_id');
  jj('new', '@-');
  writeFileSync(join(cwd, 'tracked.txt'), 'right\n');
  jj('new', left, '@');
  assert.equal((await status()).conflict, true);
});
