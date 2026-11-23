import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ansiColors, normalizeConfig } from '../src/config.js';
import { preferences } from '../src/preferences.js';

function fixture(context) {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hub-preferences-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'agy-hub.json');
  return {
    path,
    undoPath: `${path}.undo.json`,
    run: (action, argument) => JSON.parse(preferences(action, argument, { path })),
  };
}

test('schema and show read current defaults without creating a config', (context) => {
  const { path, run } = fixture(context);
  assert.deepEqual(run('show'), normalizeConfig());
  assert.deepEqual(run('schema'), {
    defaults: normalizeConfig(), colorNames: [...ansiColors.keys()],
    manualOnly: ['display.externalUsagePath', 'display.externalUsageWritePath'],
  });
  assert.deepEqual(run('check'), { valid: true, unknown: [], invalid: [], unsafe: [], exists: false });
  assert.deepEqual(run('undo'), { undone: false });
  assert.equal(existsSync(path), false);
});

test('set merges nested values while preserving manually configured file paths', (context) => {
  const { path, undoPath, run } = fixture(context);
  const original = '{ "language": "zh", "display": {"externalUsagePath":"~/quota.json","showTools":true} }\n';
  writeFileSync(path, original);

  assert.deepEqual(run('set', '{"display":{"showAgents":true,"customLine":" note "},"colors":{"context":"#9ab012"}}'), { updated: true });
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(saved, {
    language: 'zh', colors: { context: '#9ab012' },
    display: { externalUsagePath: '~/quota.json', showTools: true, showAgents: true, customLine: ' note ' },
  });
  assert.equal(run('show').language, 'zh-Hans');
  assert.equal(run('show').display.customLine, 'note');
  assert.equal(run('check').valid, true);
  assert.deepEqual(run('set', '{"display":{"showAgents":true}}'), { updated: false });
  assert.deepEqual(run('undo'), { undone: true });
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.equal(existsSync(undoPath), false);
});

test('set rejects unknown keys, invalid values, prototype keys and write paths', (context) => {
  const { path, undoPath, run } = fixture(context);
  const examples = [
    ['{"display":{"unknownOption":true}}', /Unknown keys.*display.unknownOption/],
    ['{"display":{"showTools":"true"}}', /Invalid values.*display.showTools/],
    ['{"colors":[]}', /Invalid values.*colors/],
    ['{"elementOrder":["invented"]}', /Invalid values.*elementOrder/],
    ['{"lineLayout":"invented","maxWidth":-1}', /Invalid values.*lineLayout.*maxWidth/],
    ['{"display":{"contextWarningThreshold":90,"contextCriticalThreshold":85}}', /Invalid values.*contextCriticalThreshold/],
    ['{"display":{"__proto__":{"showTools":true}}}', /Unsafe keys.*__proto__/],
    ['{"constructor":{"prototype":{"showTools":true}}}', /Unsafe keys.*constructor/],
    ['{"display":{"externalUsageWritePath":"do-not-persist"}}', /Edit these file paths directly/],
    ['{"display":{"externalUsagePath":"do-not-persist"}}', /Edit these file paths directly/],
    ['[]', /valid JSON object/],
  ];
  for (const [argument, error] of examples) assert.throws(() => run('set', argument), error);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(undoPath), false);
  assert.equal(Object.prototype.showTools, undefined);
});

test('check identifies file errors without printing configuration values', (context) => {
  const { path, run } = fixture(context);
  writeFileSync(path, '{"display": {"showTools":"private-value", "unknown": "secret-value", "prototype": {}}}');
  assert.deepEqual(run('check'), {
    valid: false, unknown: ['display.unknown'], invalid: ['display.showTools'], unsafe: ['display.prototype'], exists: true,
  });
  const malformed = '{"display":{"externalUsagePath":"/private/path"';
  writeFileSync(path, malformed);
  assert.deepEqual(run('check'), { valid: false, unknown: [], invalid: [], unsafe: [], exists: true, error: 'invalid-json' });
  assert.throws(() => run('set', '{"lineLayout":"compact"}'), /valid JSON object/);
  assert.equal(readFileSync(path, 'utf8'), malformed);
});

test('undo uses one prior version and protects changes made after a set', (context) => {
  const { path, undoPath, run } = fixture(context);
  run('set', '{"lineLayout":"compact"}');
  const first = readFileSync(path, 'utf8');
  run('set', '{"lineLayout":"expanded"}');
  const second = readFileSync(path, 'utf8');

  writeFileSync(path, `${second}\n`);
  assert.throws(() => run('undo'), /changed since the last config set/);
  assert.equal(readFileSync(path, 'utf8'), `${second}\n`);
  assert.equal(existsSync(undoPath), true);

  writeFileSync(path, second);
  assert.deepEqual(run('undo'), { undone: true });
  assert.equal(readFileSync(path, 'utf8'), first);
  assert.deepEqual(run('undo'), { undone: false });
});

test('undo removes an initially absent file and preserves an existing symlink', { skip: process.platform === 'win32' }, (context) => {
  const { path, run } = fixture(context);
  run('set', '{"lineLayout":"compact"}');
  assert.deepEqual(run('undo'), { undone: true });
  assert.equal(existsSync(path), false);

  const target = join(dirname(path), 'dotfiles.json');
  writeFileSync(target, '{}\n');
  symlinkSync(target, path);
  run('set', '{"lineLayout":"compact"}');
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).lineLayout, 'compact');
  assert.ok(lstatSync(path).isSymbolicLink());
  assert.deepEqual(run('undo'), { undone: true });
  assert.equal(readFileSync(target, 'utf8'), '{}\n');
});
