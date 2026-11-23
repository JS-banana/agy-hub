import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';

const readOptions = {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  timeout: 250, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
};

function commandEnvironment() {
  const path = process.env.PATH?.split(delimiter).filter(isAbsolute).join(delimiter);
  return { ...process.env, PATH: path || '/usr/bin:/bin', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
}

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, '--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', ...args], { ...readOptions, env: commandEnvironment() });
}

// `git status` can invoke a clean filter configured by the checkout. Disable all
// configured drivers before asking Git to examine the working tree.
function filterOverrides(cwd) {
  const result = git(cwd, ['config', '--null', '--name-only', '--get-regexp', '^filter\\.']);
  if (result.error || ![0, 1].includes(result.status)) return null;
  const overrides = [];
  const drivers = new Set();
  for (const key of result.stdout.split('\0').filter(Boolean)) {
    const name = key.slice('filter.'.length, key.lastIndexOf('.'));
    if (!/^[\w.-]+$/.test(name)) return null;
    drivers.add(name);
  }
  for (const name of drivers) {
    overrides.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
  }
  return overrides;
}

const pathFields = { 1: 8, 2: 9, u: 10 };
const maxTrackedFiles = 6;

function readStatus(output, showFileStats) {
  let branch;
  let oid;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  const fileStats = showFileStats ? { modified: 0, added: 0, deleted: 0, untracked: 0, trackedFiles: [] } : null;
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('# branch.head ')) branch = record.slice('# branch.head '.length);
    if (record.startsWith('# branch.oid ')) oid = record.slice('# branch.oid '.length);
    const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
    if (counts) [ahead, behind] = counts.slice(1).map(Number);
    if (record.startsWith('# ')) continue;

    dirty = true;
    if (!fileStats) break;
    if (record.startsWith('? ')) {
      fileStats.untracked++;
      continue;
    }
    const fieldCount = pathFields[record[0]];
    if (!fieldCount) continue;
    const staged = record[2];
    const unstaged = record[3];
    let type = 'modified';
    if (staged === 'A' || (staged === 'U' && unstaged === 'A')) type = 'added';
    else if (staged === 'D' || unstaged === 'D') type = 'deleted';
    fileStats[type]++;
    if (fileStats.trackedFiles.length < maxTrackedFiles) {
      const fullPath = record.split(' ').slice(fieldCount).join(' ');
      fileStats.trackedFiles.push({ basename: basename(fullPath), fullPath, type });
    }
    if (record[0] === '2') index++;
  }
  const status = { branch, dirty, ahead, behind };
  if (fileStats) status.fileStats = fileStats;
  return { status, oid };
}

function addLineDiff(cwd, status, oid, overrides) {
  // diff-index compares the final working tree with the last commit without refreshing the index.
  const base = oid === '(initial)' ? git(cwd, ['hash-object', '-t', 'tree', '--stdin']).stdout?.trim() : oid;
  if (!base || !/^[a-f0-9]+$/.test(base)) return;
  const result = git(cwd, [...overrides, 'diff-index', '-M', '--numstat', '-z', '--no-relative', '--no-ext-diff',
    '--no-textconv', '--ignore-submodules=all', base, '--']);
  if (result.status !== 0) return;

  const tracked = new Map(status.fileStats.trackedFiles.map((file) => [file.fullPath, file]));
  const totals = { added: 0, deleted: 0 };
  const records = result.stdout.split('\0');
  for (let index = 0; index < records.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[index]);
    if (!match) continue;
    let fullPath = match[3];
    if (!fullPath) {
      fullPath = records[index + 2];
      index += 2;
    }
    if (!fullPath || match[1] === '-' || match[2] === '-') continue;
    const diff = { added: Number(match[1]), deleted: Number(match[2]) };
    totals.added += diff.added;
    totals.deleted += diff.deleted;
    const file = tracked.get(fullPath);
    if (file) file.lineDiff = diff;
  }
  status.lineDiff = totals;
}

function addWorktreeInfo(cwd, status, showWorktree) {
  const result = git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  if (result.status !== 0) return;
  const paths = result.stdout.replace(/\n$/, '').split('\n');
  if (paths.length !== 3 || !paths.every(isAbsolute)) return;
  const [root, worktreeGitDir, sharedGitDir] = paths;
  status.root = root;
  if (showWorktree && dirname(worktreeGitDir) === join(sharedGitDir, 'worktrees')) status.worktree = basename(root);
}

function readGitStatus(cwd, { showAheadBehind, showDirty, showFileStats, showWorktree }) {
  const overrides = filterOverrides(cwd);
  if (!overrides) return gitBranchOnly(cwd);
  const untracked = showFileStats ? 'all' : showDirty ? 'normal' : 'no';
  const result = git(cwd, [...overrides, 'status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=all',
    showAheadBehind ? '--ahead-behind' : '--no-ahead-behind', `--untracked-files=${untracked}`,
    ...(showFileStats ? ['--find-renames'] : [])]);
  if (result.status !== 0) return gitBranchOnly(cwd);

  const { status, oid } = readStatus(result.stdout, showFileStats);
  if (!status.branch) return null;
  if (status.branch === '(detached)') {
    const tag = git(cwd, ['describe', '--tags', '--exact-match', 'HEAD']);
    status.branch = tag.status === 0 ? tag.stdout.trim() : oid ? `detached:${oid.slice(0, 7)}` : 'HEAD';
  }
  if (status.fileStats?.trackedFiles.length) addLineDiff(cwd, status, oid, overrides);
  if (showWorktree || status.fileStats?.trackedFiles.length) addWorktreeInfo(cwd, status, showWorktree);
  return status;
}

function gitBranchOnly(cwd) {
  const head = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return head.status === 0 ? { branch: head.stdout.trim(), dirty: false, ahead: 0, behind: 0 } : null;
}

function pathInfo(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function findJjRoot(cwd) {
  try {
    let directory = realpathSync(cwd);
    for (let depth = 0; depth < 64; depth++) {
      const metadata = pathInfo(join(directory, '.jj'));
      if (metadata) return metadata.isDirectory() ? directory : null;
      if (pathInfo(join(directory, '.git'))) return null;
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  } catch { /* the workspace moved or cannot be read */ }
  return null;
}

const jjTemplate = 'change_id.shortest(8) ++ "\\x1f" ++ self.local_bookmarks().map(|bookmark| bookmark.name()).join("\\x1e")'
  + ' ++ "\\x1f" ++ if(self.empty(), "0", "1") ++ "\\x1f" ++ if(self.conflict(), "1", "0")';

function readJjStatus(cwd) {
  const metadata = join(cwd, '.jj');
  const repo = join(metadata, 'repo');
  // Older jj versions load config from metadata in the workspace. A repo pointer
  // could also redirect us to legacy config outside the workspace we inspected.
  if (!pathInfo(repo)?.isDirectory() || pathInfo(join(metadata, 'config.toml')) || pathInfo(join(repo, 'config.toml'))) return null;
  const result = spawnSync('jj', ['--ignore-working-copy', '--at-operation=@', '--no-pager',
    'log', '-r', '@', '--no-graph', '--color', 'never', '-T', jjTemplate], {
    ...readOptions, cwd, maxBuffer: 16 * 1024, env: { ...commandEnvironment(), JJ_CONFIG: '' },
  });
  if (result.status !== 0) return null;
  const fields = result.stdout.split('\x1f');
  if (fields.length !== 4) return null;
  const [changeId, bookmarks, dirty, conflict] = fields;
  if (!/^[a-z]{8,}$/.test(changeId) || !/^[01]$/.test(dirty) || !/^[01]$/.test(conflict)) return null;
  const branch = bookmarks.split('\x1e')[0] || changeId;
  return { branch, dirty: dirty === '1', ahead: 0, behind: 0, vcs: 'jj', conflict: conflict === '1' };
}

export function gitStatus(cwd, gitConfig = {}, vcs, jjConfig) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0') || (vcs && vcs !== 'git' && vcs !== 'jj')) return null;
  // Windows resolves unqualified programs from the working directory before PATH.
  if (process.platform === 'win32') return null;
  const jjRoot = jjConfig?.enabled || vcs === 'jj' ? findJjRoot(cwd) : null;
  if (vcs === 'jj' && !jjRoot) return null;
  if (jjRoot) {
    try {
      const jj = jjConfig?.enabled ? readJjStatus(jjRoot) : null;
      if (jj) return jj;
      if (!pathInfo(join(jjRoot, '.git'))) return null;
    } catch { return null; }
  }
  return gitConfig.enabled === false ? null : readGitStatus(cwd, gitConfig);
}
