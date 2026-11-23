import type { HudConfig } from '../config-schema.js';
import type { HudState } from '../state.js';
import type { messages } from '../messages.js';

export type ColorKey = Exclude<keyof HudConfig['colors'], 'barFilled' | 'barEmpty'>;

interface LineDiff {
  added: number;
  deleted: number;
}

export interface GitDetails {
  branch: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  vcs?: 'git' | 'jj';
  conflict?: boolean;
  root?: string;
  worktree?: string;
  lineDiff?: LineDiff;
  fileStats?: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    trackedFiles: {
      basename: string;
      fullPath: string;
      type: 'modified' | 'added' | 'deleted';
      lineDiff?: LineDiff;
    }[];
  };
}

export interface ToolCall {
  name: string;
  kind?: 'tools' | 'skills' | 'mcp';
  target?: string;
}

export interface RenderDetails {
  git?: GitDetails | null;
  activity?: {
    model?: string;
    started?: number;
    lastReply?: number;
    speed?: number;
    running?: ToolCall[];
    completed?: (Pick<ToolCall, 'name' | 'kind'> & { count: number })[];
  } | null;
  memory?: { used: number; total: number } | null;
  environment?: { instructions: number; rules: number; mcp: number; hooks: number } | null;
  costTotals?: { day: number; week: number | null } | null;
  extra?: string;
  color?: boolean;
}

export interface Frame extends RenderDetails {
  state: HudState;
  config: HudConfig;
  width: number;
  barWidth: number;
  color: boolean;
  style: (text: string, key: ColorKey) => string;
  words: ReturnType<typeof messages>;
}
