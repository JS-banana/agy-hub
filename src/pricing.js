// @ts-check
import { nonnegative } from './state.js';

/** @typedef {{input: number, output: number, intro?: {until: number, input: number, output: number}}} Rates */
/** @typedef {Pick<import('./state.js').HudState, 'cost' | 'input' | 'output' | 'model' | 'modelId' | 'now'>} CostInputs */

// Standard text API prices in USD per million tokens. Sources are listed in docs/integration.md.
const flash = { input: 1.50, output: 7.50, intro: { until: Date.UTC(2027, 0, 1), input: 0.75, output: 3.75 } };
const argonAndCarbon = { input: 4, output: 20, intro: { until: Date.UTC(2026, 11, 1), input: 2, output: 10 } };
const pro31 = { input: 2, output: 12 }; // Standard prompt tier.
const sonnet37 = { input: 3, output: 15 };
const opus4 = { input: 15, output: 75 };
/** @type {Map<string, Rates>} */
const modelRates = new Map([
  ['gemini-3-6-flash', flash],
  ['gemini-3-7-flash', flash],
  ['gemini-3-8-flash', flash],
  ['gemini-3-1-pro', pro31],
  ['gemini-3-1-pro-preview', pro31],
  ['gemini-4-argon', argonAndCarbon],
  ['gemini-4-carbon', argonAndCarbon],
  ['gemini-4-neon', { input: 3, output: 15 }],
  ['gemini-4-hydrogen', { input: 1.50, output: 7.50 }],
  ['claude-sonnet-5-5', { input: 2, output: 10 }],
  ['claude-opus-5-5', { input: 4, output: 20 }],
  ['claude-sonnet-4-6', { input: 3, output: 15 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-3-7-sonnet', sonnet37],
  ['claude-3-7-sonnet-20250219', sonnet37],
  ['claude-sonnet-3-7', sonnet37],
  ['claude-opus-4', opus4],
  ['claude-opus-4-20250514', opus4],
]);

/** @param {unknown} value */
function modelKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^models\//, '')
    .replace(/\s*\((?:thinking|low|medium|high|extra|xhigh|max)\)$/, '')
    .replace(/[.\s]+/g, '-')
    .replace(/-(?:thinking|low|medium|high|extra|xhigh|max)$/, '');
}

/** Resolve the session display amount without changing the reported cost or its ledger.
 *  @param {CostInputs} state
 *  @returns {{usd: number, local: boolean} | null}
 */
export function resolveCost({ cost, input, output, model, modelId, now }) {
  const reported = nonnegative(cost);
  if (reported !== null) return { usd: reported, local: false };
  if (input === null || output === null || !Number.isSafeInteger(input) || !Number.isSafeInteger(output)
    || input < 0 || output < 0 || (input === 0 && output === 0)) return null;
  const modelRate = modelRates.get(modelKey(modelId)) ?? modelRates.get(modelKey(model));
  if (!modelRate) return null;
  const rates = modelRate.intro && now < modelRate.intro.until ? modelRate.intro : modelRate;
  return { usd: (input * rates.input + output * rates.output) / 1_000_000, local: true };
}
