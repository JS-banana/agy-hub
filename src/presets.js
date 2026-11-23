// @ts-check

const presets = {
  default: {},
  compact: { lineLayout: 'compact' },
  activity: { display: { showTools: true, showAgents: true }, showSeparators: true },
};

export const presetNames = Object.keys(presets);

/** @param {string} [name] */
export function presetConfig(name = 'default') {
  if (!Object.hasOwn(presets, name)) throw new Error(`Unknown preset ${JSON.stringify(name)}. Choose ${presetNames.join(', ')}.`);
  return structuredClone(presets[/** @type {keyof typeof presets} */ (name)]);
}
