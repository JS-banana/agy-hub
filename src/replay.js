import { homedir } from 'node:os';
import { join } from 'node:path';
import { dataDir, readObject, writeObject } from './local-data.js';

const target = () => join(dataDir(), 'preview.json');

export function recordPreview(state, details) {
  const activity = details.activity;
  const screen = {
    state: {
      ...state, cwd: state.cwd ? '/workspace/project' : undefined, launchDir: undefined,
      addedDirs: state.addedDirs.map((_, index) => `/workspace/dir-${index + 1}`),
      conversationId: undefined, transcriptPath: undefined, email: state.email ? 'example@example.test' : '',
      title: state.title ? 'Example conversation' : '',
      agents: state.agents.map((agent, index) => ({ ...agent, name: `agent-${index + 1}`, role: '' })),
    },
    details: {
      ...details, extra: undefined, git: details.git ? { ...details.git, branch: 'main', root: undefined, worktree: undefined,
        fileStats: details.git.fileStats ? { ...details.git.fileStats,
          trackedFiles: details.git.fileStats.trackedFiles.map(({ type, lineDiff }, index) => (
            { type, lineDiff, basename: `file-${index + 1}`, fullPath: `file-${index + 1}` }
          )),
        } : undefined,
      } : null,
      activity: activity ? { ...activity, running: activity.running?.map(({ name, kind, target: path }) => (
        { name, kind, target: path ? 'file' : '' }
      )) } : null,
    },
  };
  try { writeObject(target(), screen); } catch { /* Rendering also works without a snapshot. */ }
}

export function recordedPreview() {
  const value = readObject(target());
  return value?.state && value?.details ? value : null;
}

export function diagnostics(statusline, configuration) {
  const settings = readObject(join(homedir(), '.gemini', 'antigravity-cli', 'settings.json'));
  const last = recordedPreview();
  const state = last?.state;
  return {
    node: process.versions.node,
    platform: process.platform,
    configuration,
    statuslineInstalled: Boolean(settings && settings.statusLine?.command === statusline),
    statuslineEnabled: Boolean(settings?.statusLine?.command && settings.statusLine.enabled !== false),
    capturedFrame: state ? {
      version: state.version || null,
      columns: state.width,
      context: Boolean(state.context),
      quota: Boolean(state.quota.short || state.quota.weekly),
      tools: Boolean(last.details.activity?.running?.length || last.details.activity?.completed?.length),
      agents: state.agents.length,
    } : null,
  };
}
