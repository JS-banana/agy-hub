import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, '--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    timeout: 250, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
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

function readStatus(output) {
  let branch;
  let oid;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  for (const entry of output.split('\0')) {
    if (!entry) continue;
    if (!entry.startsWith('# ')) {
      dirty = true;
      break;
    }
    if (entry.startsWith('# branch.head ')) branch = entry.slice('# branch.head '.length);
    if (entry.startsWith('# branch.oid ')) oid = entry.slice('# branch.oid '.length);
    const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(entry);
    if (counts) [ahead, behind] = counts.slice(1).map(Number);
  }
  if (branch === '(detached)') branch = oid ? `detached:${oid.slice(0, 7)}` : 'HEAD';
  return branch ? { branch, dirty, ahead, behind } : null;
}

export function gitStatus(cwd, { showAheadBehind, showDirty }, vcs) {
  if (!cwd || !isAbsolute(cwd) || cwd.includes('\0') || (vcs && vcs !== 'git')) return null;
  // Windows resolves unqualified programs from the working directory before PATH.
  if (process.platform === 'win32') return null;
  const overrides = filterOverrides(cwd);
  if (overrides) {
    const result = git(cwd, [...overrides, 'status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=all',
      showAheadBehind ? '--ahead-behind' : '--no-ahead-behind', showDirty ? '--untracked-files=normal' : '--untracked-files=no']);
    if (result.status === 0) return readStatus(result.stdout);
  }
  const head = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return head.status === 0 ? { branch: head.stdout.trim(), dirty: false, ahead: 0, behind: 0 } : null;
}
