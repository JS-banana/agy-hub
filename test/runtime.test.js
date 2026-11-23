import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../src/config.js';
import { readInput } from '../src/runtime/input.js';

test('stdin uses a byte limit and decodes UTF-8 across chunks', async () => {
  const bytes = Buffer.from('{"model":"星"}');
  const split = bytes.indexOf(0xe6) + 1;
  assert.deepEqual(await readInput(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]), bytes.length), { model: '星' });
  assert.equal(await readInput(Readable.from([bytes]), bytes.length - 1), null);
  assert.equal(await readInput(Readable.from(['[]'])), null);
});

test('config accepts regular symlinks and ignores oversized input and FIFOs without blocking', { skip: process.platform === 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hub-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const regular = join(root, 'hud.json');
  const link = join(root, 'link.json');
  const pipe = join(root, 'pipe.json');
  writeFileSync(regular, '{"lineLayout":"compact"}');
  symlinkSync(regular, link);
  assert.equal(readConfig(link).lineLayout, 'compact');
  writeFileSync(regular, '{"lineLayout":"compact"}' + ' '.repeat(100_000));
  assert.equal(readConfig(link).lineLayout, 'expanded');
  execFileSync('mkfifo', [pipe]);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [cli], {
    input: '{"model":{"display_name":"Protected"},"context_window":{"used_percentage":3}}',
    env: { ...process.env, HOME: root, AGY_HUB_CONFIG: pipe, NO_COLOR: '1', AGY_HUB_DISABLE: '0' },
    encoding: 'utf8', timeout: 2000,
  });
  assert.match(output, /\[Protected\]\nContext/);
  const doctor = JSON.parse(execFileSync(process.execPath, [cli, 'doctor'], {
    env: { ...process.env, HOME: root, AGY_HUB_CONFIG: pipe }, encoding: 'utf8', timeout: 2000,
  }));
  assert.equal(doctor.configuration.error, 'unreadable');
});

test('preset preview is independent of an existing configuration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hub-preset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'config.json');
  writeFileSync(config, '{"lineLayout":"compact","display":{"showModel":false}}');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const preview = execFileSync(process.execPath, [cli, 'preview', '--preset', 'default', '--plain'], {
    env: { ...process.env, AGY_HUB_CONFIG: config }, encoding: 'utf8',
  });
  assert.match(preview, /^\[Gemini [^\n]+\nContext /);
});

test('a partial replay file is a cache miss in diagnostics', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hub-replay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'preview.json'), '{"state":{},"details":{}}');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'report'], {
    env: { ...process.env, HOME: root, AGY_HUB_DATA_DIR: data, AGY_HUB_CONFIG: join(root, 'hud.json') }, encoding: 'utf8',
  });
  const report = JSON.parse(output);
  assert.equal(report.capturedFrame, null);
  assert.equal('paths' in report, false);
  assert.doesNotMatch(output, /agy-hub-replay-/);
});
