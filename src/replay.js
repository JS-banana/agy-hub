import { join } from 'node:path';
import { dataDir } from './local-data.js';
import { isRecord } from './objects.js';
import { readObject, writeObject } from './runtime/json-file.js';

const target = () => join(dataDir(), 'preview.json');

export function recordPreview(state, details) {
  const activity = details.activity;
  const screen = {
    version: 1,
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
  if (value?.version !== 1) return null;
  const { state, details } = value;
  if (!isRecord(state) || !isRecord(details) || !isRecord(state.quota) || !Number.isFinite(state.now)
    || typeof state.model !== 'string' || !Array.isArray(state.addedDirs) || !state.addedDirs.every((path) => typeof path === 'string')
    || !Array.isArray(state.agents) || !state.agents.every((agent) => isRecord(agent) && typeof agent.name === 'string')) return null;
  return value;
}
