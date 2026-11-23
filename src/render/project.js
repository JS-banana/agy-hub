// @ts-check
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { labelText, linkPath, pack } from '../terminal.js';

/** @typedef {import('./types.js').Frame} Frame */
/** @param {unknown} cwd @param {Frame['config']['pathLevels']} levels */
function projectPath(cwd, levels) {
  const safe = labelText(cwd);
  if (!safe || levels === 'full') return safe;
  return safe.split(/[/\\]/).filter(Boolean).slice(-levels).join('/') || safe;
}

/** @param {Frame} frame @param {boolean} compact */
function branchPart(frame, compact) {
  const { config, style, git } = frame;
  if (!git) return '';
  const name = labelText(git.branch);
  if (!name || !(git.vcs === 'jj' ? config.jjStatus.enabled : config.gitStatus.enabled)) return '';
  const isJj = git.vcs === 'jj';
  const opts = config.gitStatus;
  const showDirty = isJj ? config.jjStatus.showDirty : opts.showDirty;
  const fields = [style(name + (showDirty && git.dirty ? '*' : ''), 'gitBranch')];
  if (isJj && config.jjStatus.showConflicts && git.conflict) fields.push(style('!conflict', 'critical'));
  if (!isJj && opts.showAheadBehind) {
    const { pushWarningThreshold: warn, pushCriticalThreshold: critical } = opts;
    if (git.ahead) {
      const shade = critical > 0 && git.ahead >= critical ? 'critical'
        : warn > 0 && git.ahead >= warn ? 'warning' : 'gitBranch';
      fields.push(style(`↑${git.ahead}`, shade));
    }
    if (git.behind) fields.push(style(`↓${git.behind}`, 'gitBranch'));
  }
  if (!isJj && opts.showFileStats && compact && git.fileStats) {
    const markers = /** @type {const} */ ([['modified', '!'], ['added', '+'], ['deleted', '✘'], ['untracked', '?']]);
    for (const [key, symbol] of markers) {
      if (git.fileStats[key]) fields.push(style(`${symbol}${git.fileStats[key]}`, 'gitBranch'));
    }
  }
  if (!compact && opts.showFileStats && git.lineDiff) {
    const diff = [git.lineDiff.added ? style(`+${git.lineDiff.added}`, 'context') : '',
      git.lineDiff.deleted ? style(`-${git.lineDiff.deleted}`, 'critical') : ''].filter(Boolean);
    if (diff.length) fields.push(`[${diff.join(' ')}]`);
  }
  const worktree = opts.showWorktree && labelText(git.worktree);
  return style(isJj ? 'jj:(' : 'git:(', 'git') + fields.join(' ') + style(')', 'git')
    + (worktree ? ' ' + style(`⎇ ${worktree}`, 'git') : '');
}

/** @param {Frame} frame */
export function addedDirs(frame) {
  const { state, config, style, color } = frame;
  if (!config.display.showAddedDirs) return [];
  return state.addedDirs.map((path) => linkPath(path, style(`+${projectPath(path, 1)}`, 'label'), color && config.display.showLinks));
}

/** @param {Frame} frame @param {boolean} compact */
export function projectParts(frame, compact) {
  const { state, config, style, color } = frame;
  const { display, pathLevels } = config;
  let project = '';
  if (display.showProject && state.cwd) {
    const path = projectPath(state.cwd, pathLevels);
    const launch = state.launchDir && relative(state.launchDir, state.cwd);
    const outside = launch && (launch === '..' || launch.startsWith('..' + sep) || isAbsolute(launch));
    const beyond = launch && typeof pathLevels === 'number' && launch.split(sep).length >= pathLevels;
    const prefix = display.showLaunchDir && pathLevels !== 'full' && (outside || beyond)
      ? `${projectPath(state.launchDir, 1)} › ` : '';
    project = linkPath(state.cwd, style(prefix + path, 'project'), color && display.showLinks && !compact);
  }
  if (display.addedDirsLayout === 'inline') project = [project, ...addedDirs(frame)].filter(Boolean).join(' ');
  const branch = branchPart(frame, compact);
  if (!branch || !project) return [project || branch];
  return config.gitStatus.branchOverflow === 'wrap' ? [project, branch] : [`${project} ${branch}`];
}

/** @param {Frame} frame */
export function changedFiles(frame) {
  const { config, git, style, width, color } = frame;
  if (!config.gitStatus.enabled || !config.gitStatus.showFileStats || !git?.fileStats || width < 60) return [];
  const { trackedFiles, modified, added, deleted, untracked } = git.fileStats;
  const fileStyle = /** @type {const} */ ({ modified: ['~', 'warning'], added: ['+', 'context'], deleted: ['-', 'critical'] });
  const parts = trackedFiles.map(({ basename, fullPath, type, lineDiff }) => {
    const [prefix, shade] = fileStyle[type];
    const path = git.root ? resolve(git.root, fullPath) : '';
    const inside = !!git.root && !relative(git.root, path).split(sep).includes('..');
    const name = linkPath(path, style(labelText(basename), shade), inside && color && config.display.showLinks);
    const diff = [lineDiff?.added ? style(`+${lineDiff.added}`, 'context') : '',
      lineDiff?.deleted ? style(`-${lineDiff.deleted}`, 'critical') : ''].filter(Boolean);
    return style(prefix, shade) + name + (diff.length ? `(${diff.join(' ')})` : '');
  });
  const more = modified + added + deleted - trackedFiles.length;
  if (more > 0) parts.push(style(`+${more} more`, 'label'));
  if (untracked > 0) parts.push(style(`?${untracked}`, 'label'));
  return pack(parts, '  ', width);
}
