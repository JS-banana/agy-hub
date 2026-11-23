import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { gitStatus } from '../src/git.js';

const gitOptions = { showFileStats: true, showWorktree: true, showDirty: true };
const gitAvailable = process.platform !== 'win32' && spawnSync('git', ['--version']).status === 0;
const jjAvailable = process.platform !== 'win32' && spawnSync('jj', ['--version']).status === 0;

function temp(context) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agy-hub-vcs-')));
  context.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=AGY Hub Tests', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function init(cwd) {
  git(cwd, 'init', '--initial-branch=main', '--template=');
}

test('Git combines index and worktree stats, with rename, binary and nested untracked files', { skip: !gitAvailable }, (context) => {
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
  writeFileSync(join(root, ' add\tfile.txt'), 'staged\n');
  git(root, 'add', ' add\tfile.txt');
  writeFileSync(join(root, 'contents.bin'), Buffer.from([0, 1, 3]));
  mkdirSync(join(root, 'scratch'));
  writeFileSync(join(root, 'scratch', 'one'), '1');
  writeFileSync(join(root, 'scratch', 'two'), '2');

  const index = readFileSync(join(root, '.git', 'index'));
  const status = gitStatus(join(root, 'nested'), gitOptions, 'git');
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
  assert.deepEqual(files.get(' add\tfile.txt').lineDiff, { added: 1, deleted: 0 });
  assert.equal(files.get('contents.bin').lineDiff, undefined);
  assert.deepEqual(readFileSync(join(root, '.git', 'index')), index);
});

test('Git caps listed files while keeping the complete counts in an unborn branch', { skip: !gitAvailable }, (context) => {
  const root = temp(context);
  init(root);
  for (let index = 0; index < 9; index++) writeFileSync(join(root, `change-${index}`), 'new\n');
  git(root, 'add', '.');

  const status = gitStatus(root, gitOptions);
  assert.equal(status.branch, 'main');
  assert.equal(status.fileStats.added, 9);
  assert.equal(status.fileStats.trackedFiles.length, 6);
  assert.deepEqual(status.fileStats.trackedFiles[0].lineDiff, { added: 1, deleted: 0 });
  assert.deepEqual(status.lineDiff, { added: 9, deleted: 0 });
});

test('Git detects linked worktrees and names a detached head only for an exact tag', { skip: !gitAvailable }, (context) => {
  const base = temp(context);
  const cwd = join(base, 'repo');
  const worktree = join(base, 'linked workspace');
  mkdirSync(cwd);
  init(cwd);
  git(cwd, 'commit', '--allow-empty', '-m', 'Release');
  git(cwd, 'tag', '-a', 'v1.0.0', '-m', 'release');
  git(cwd, 'commit', '--allow-empty', '-m', 'Next');
  git(cwd, 'worktree', 'add', '--detach', worktree, 'v1.0.0');

  assert.equal(gitStatus(cwd, gitOptions).worktree, undefined);
  const linked = gitStatus(worktree, gitOptions);
  assert.equal(linked.worktree, basename(worktree));
  assert.equal(linked.branch, 'v1.0.0');
  assert.equal(linked.root, worktree);
  assert.equal(gitStatus(worktree, {}).worktree, undefined);
  git(worktree, 'checkout', '--detach', 'main');
  assert.equal(gitStatus(worktree, gitOptions).branch, `detached:${git(cwd, 'rev-parse', 'HEAD').slice(0, 7)}`);
});

test('Git reads status with checkout-configured clean, diff and textconv drivers disabled', { skip: !gitAvailable }, (context) => {
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

  assert.deepEqual(gitStatus(cwd, gitOptions).lineDiff, { added: 1, deleted: 0 });
});

test('a jj checkout with local configuration falls back only to colocated Git', { skip: !gitAvailable }, (context) => {
  const cwd = temp(context);
  const checkout = join(cwd, 'workspace');
  mkdirSync(join(checkout, '.jj', 'repo'), { recursive: true });
  writeFileSync(join(checkout, '.jj', 'repo', 'config.toml'), '[ui]\npager = "none"\n');
  init(cwd);
  assert.equal(gitStatus(checkout, {}, 'jj', { enabled: true }), null);
  init(checkout);
  assert.deepEqual(gitStatus(checkout, {}, 'jj', { enabled: true }), { branch: 'main', dirty: false, ahead: 0, behind: 0 });
});

test('Jujutsu shows a bookmark, recorded changes and conflicts without snapshotting the working copy', { skip: !jjAvailable }, (context) => {
  const cwd = temp(context);
  const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'AGY Hub Tests', JJ_EMAIL: 'test@example.invalid', XDG_CONFIG_HOME: cwd };
  const jj = (...args) => execFileSync('jj', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  jj('git', 'init', '--no-colocate');
  const status = () => gitStatus(cwd, { enabled: false }, 'jj', { enabled: true });

  assert.match(status().branch, /^[a-z]{8,}$/);
  assert.equal(status().dirty, false);
  writeFileSync(join(cwd, 'tracked.txt'), 'base\n');
  assert.equal(status().dirty, false);
  jj('bookmark', 'create', 'hud-bookmark', '-r', '@');
  assert.deepEqual(status(), { branch: 'hud-bookmark', dirty: true, ahead: 0, behind: 0, vcs: 'jj', conflict: false });
  jj('new', '@');
  writeFileSync(join(cwd, 'tracked.txt'), 'left\n');
  const left = jj('log', '-r', '@', '--no-graph', '-T', 'change_id');
  jj('new', '@-');
  writeFileSync(join(cwd, 'tracked.txt'), 'right\n');
  jj('new', left, '@');
  assert.equal(status().conflict, true);
});
