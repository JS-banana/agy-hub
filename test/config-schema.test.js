import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configRules, DEFAULT_CONFIG, inspectConfig, jsonSchema, normalizeConfig } from '../src/config-schema.js';

test('declares every default, documentation entry, and schema entry in the same rule', () => {
  const schema = jsonSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.display.additionalProperties, false);
  for (const [key, entry] of Object.entries(configRules)) {
    const path = key.split('.');
    const field = path.reduce((node, part) => node.properties[part], schema);
    const fallback = path.reduce((data, part) => data[part], DEFAULT_CONFIG);
    assert.ok(field.description.startsWith(entry.description), key);
    assert.deepEqual(field.default, fallback, key);
    assert.deepEqual(entry.defaultValue, fallback, key);
  }
  assert.deepEqual(schema.properties.display.properties.contextValue.enum, ['percent', 'tokens', 'remaining', 'both']);
  assert.equal(schema.properties.display.properties.authUserLength.maximum, 320);
  assert.deepEqual(Object.keys(configRules).filter((key) => configRules[key].manualOnly),
    ['display.externalUsagePath', 'display.externalUsageWritePath']);
});

test('normalizes legacy config and allows editor metadata without mixing it into the HUD', () => {
  const raw = {
    $schema: './agy-hub.schema.json',
    language: 'zh-TW',
    pathLevels: 'full',
    maxWidth: null,
    display: { modelOverride: '  Example  ', externalUsagePath: ' ~/quota.json ' },
    colors: { context: '#2FaB7D', custom: 0 },
  };
  assert.equal(inspectConfig(raw).valid, true);
  const config = normalizeConfig(raw);
  assert.equal(config.language, 'zh-Hant');
  assert.equal(config.pathLevels, 'full');
  assert.equal(config.maxWidth, null);
  assert.equal(config.display.modelOverride, 'Example');
  assert.equal(config.display.externalUsagePath, '~/quota.json');
  assert.equal(config.colors.custom, 0);
  assert.equal(Object.hasOwn(config, '$schema'), false);
});

test('runtime applies local fallbacks, while explicit configuration reports invalid and unsafe paths', () => {
  const raw = JSON.parse('{"$schema":false,"language":"invalid","elementOrder":["usage","bad","usage"],'
    + '"display":{"contextWarningThreshold":90,"contextCriticalThreshold":85,"showAgents":true,"__proto__":{"showTools":true},'
    + '"mergeGroups":[["project","usage"],["context"],["project","bad","usage","usage"]],'
    + '"customLine":"\\u001b[31m note \\u001b[0m","unknown":"private"},'
    + '"colors":{"critical":256,"barFilled":""}}');
  assert.deepEqual(inspectConfig(raw), {
    valid: false,
    unknown: ['display.unknown'],
    invalid: ['$schema', 'language', 'elementOrder', 'display.mergeGroups', 'display.customLine',
      'colors.critical', 'colors.barFilled', 'display.contextCriticalThreshold'],
    unsafe: ['display.__proto__'],
  });
  const config = normalizeConfig(raw);
  assert.deepEqual(config.elementOrder, ['usage']);
  assert.deepEqual(config.display.mergeGroups, [['project', 'usage'], ['project', 'usage']]);
  assert.equal(config.display.contextCriticalThreshold, 90);
  assert.equal(config.display.showAgents, true);
  assert.equal(config.display.showTools, false);
  assert.equal(config.display.customLine, 'note');
  assert.equal(config.colors.critical, 'red');
  assert.equal(config.colors.barFilled, '█');
  assert.equal(Object.prototype.showTools, undefined);
});

test('separate frames and generated schemas cannot mutate rule defaults', () => {
  const config = normalizeConfig();
  const schema = jsonSchema();
  config.elementOrder.length = 0;
  config.display.mergeGroups[0].push('tasks');
  schema.properties.language.enum.length = 0;
  assert.ok(normalizeConfig().elementOrder.length > 0);
  assert.deepEqual(normalizeConfig().display.mergeGroups, [['context', 'usage']]);
  assert.ok(jsonSchema().properties.language.enum.includes('en'));
});

test('checks progress glyphs with the same terminal cell width as the renderer', () => {
  const wide = { colors: { barFilled: 'XY', barEmpty: '界' } };
  assert.deepEqual(inspectConfig(wide).invalid, ['colors.barFilled', 'colors.barEmpty']);
  const glyphs = normalizeConfig(wide).colors;
  assert.equal(glyphs.barFilled, '█');
  assert.equal(glyphs.barEmpty, '░');
  const oneCell = { colors: { barFilled: 'e\u0301', barEmpty: '.' } };
  assert.equal(inspectConfig(oneCell).valid, true);
  assert.equal(normalizeConfig(oneCell).colors.barFilled, 'e\u0301');
});
