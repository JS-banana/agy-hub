import { configPath } from './config.js';
import { preferences } from './preferences.js';
import { recordedPreview } from './replay.js';
import { commandOnPath, diagnoseInstallation, settingsPath } from './setup.js';

export async function diagnostics(redacted = false) {
  const [statusline, agy, git, jj] = await Promise.all([
    diagnoseInstallation(), commandOnPath('agy'), commandOnPath('git'), commandOnPath('jj'),
  ]);
  const configuration = JSON.parse(preferences('check'));
  const last = recordedPreview();
  const state = last?.state;
  if (redacted) {
    for (const key of ['unknown', 'invalid', 'unsafe']) configuration[key] = configuration[key].length;
  }
  return {
    node: process.versions.node,
    platform: process.platform,
    configuration,
    statuslineInstalled: ['active', 'disabled'].includes(statusline.state),
    statuslineEnabled: statusline.enabled,
    statusline,
    tools: { agy, git, jj },
    ...(redacted ? {} : { paths: { config: configPath(), settings: settingsPath() } }),
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
