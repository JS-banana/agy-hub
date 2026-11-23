// @ts-check
import { parseArgs } from 'node:util';
import { applySetupPreferences, mergeConfig, parseConfigPatch, preferencesLocked, previewPreferences } from './preferences.js';
import { presetConfig } from './presets.js';
import { samplePreview } from './preview.js';
import { diagnoseInstallation, install } from './setup.js';

/** @param {string[]} args */
export async function runSetup(args) {
  const { values } = parseArgs({ args, options: {
    yes: { type: 'boolean' }, preset: { type: 'string' }, set: { type: 'string' },
    'configure-only': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, replace: { type: 'boolean' },
    json: { type: 'boolean' }, plain: { type: 'boolean' },
  } });
  const configureOnly = values['configure-only'] === true;
  const dryRun = values['dry-run'] === true;
  const interactive = !dryRun && !values.yes;
  if (interactive && (!process.stdin.isTTY || !process.stdout.isTTY || values.json)) {
    throw new Error('Run setup in a terminal, or use --dry-run to preview and --yes to apply.');
  }

  const preset = values.preset === undefined ? {} : {
    lineLayout: values.preset === 'compact' ? 'compact' : 'expanded',
    ...presetConfig(values.preset),
  };
  let patch = mergeConfig(preset, values.set === undefined ? {} : parseConfigPatch(values.set));
  /** @param {Record<string, unknown>} draft */
  const planPreferences = (draft) => previewPreferences(draft, { guided: true });
  const candidate = planPreferences(patch);
  const binding = configureOnly ? null : await diagnoseInstallation();
  const customStatusline = binding?.state === 'custom';
  const bindingBlocked = ['unsupported', 'unreadable', 'invalid-backup', 'too-large'].includes(binding?.state ?? '');
  const blockedBindingMessage = 'AGY Hub cannot update this statusline. Run agy-hub doctor for details.';
  if (bindingBlocked && !dryRun) throw new Error(blockedBindingMessage);
  const width = process.stdout.columns > 0 ? Math.min(110, process.stdout.columns) : 110;
  /** @param {import('./config-schema.js').HudConfig} config */
  const preview = (config) => samplePreview(config, { width, color: !values.plain && !values.json && !process.env.NO_COLOR });

  if (interactive) {
    const { setupWizard } = await import('./setup-wizard.js');
    const changes = await setupWizard({
      config: candidate.config, configureOnly, customStatusline,
      preview: (draft) => preview(planPreferences(mergeConfig(patch, draft)).config),
    });
    if (changes === null) return '';
    patch = mergeConfig(patch, changes);
  }

  if (dryRun) {
    const configLocked = Object.keys(patch).length > 0 && preferencesLocked();
    const screen = preview(candidate.config);
    if (values.json) return JSON.stringify({
      preview: screen, configChanged: candidate.changed, configureOnly, statusline: binding?.state ?? null,
      blocked: bindingBlocked || configLocked, configLocked,
      needsReplacement: customStatusline && !values.replace,
    }, null, 2);
    return [
      'Sample preview', screen, '',
      candidate.changed ? 'HUD configuration would be updated.' : 'HUD configuration already matches.',
      configLocked && 'HUD configuration is locked. Try again when the other configuration command has finished.',
      !configureOnly && (bindingBlocked ? blockedBindingMessage
        : customStatusline
          ? values.replace ? 'The existing statusline would be saved for uninstall.' : 'A different statusline is configured. Add --replace only after approving its replacement.'
          : 'AGY Hub would be enabled for new agy sessions.'),
    ].filter((line) => line !== false).join('\n');
  }

  let changed = false;
  let installed = null;
  if (configureOnly) {
    changed = (await applySetupPreferences(patch, async () => null)).changed;
  } else {
    installed = await install({
      replaceCustom: values.replace === true || (interactive && customStatusline),
      apply: async (commit) => {
        const result = await applySetupPreferences(patch, commit);
        changed = result.changed;
        return result.installation;
      },
    });
  }
  if (values.json) return JSON.stringify({ configChanged: changed, configureOnly, installation: installed }, null, 2);
  if (configureOnly && !changed) return 'HUD configuration already matches.';
  return [changed ? 'Saved HUD configuration.' : '', installed].filter(Boolean).join('\n');
}
