import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { setupWizard } from '../src/setup-wizard.js';

async function run(answers, options = {}) {
  let screen = '';
  const previews = [];
  const output = new Writable({
    write(chunk, encoding, callback) {
      screen += chunk.toString();
      callback();
    },
  });
  const patch = await setupWizard({
    config: normalizeConfig(),
    input: Readable.from([answers]),
    output,
    async preview(candidate) {
      previews.push(candidate);
      return '[candidate HUD]';
    },
    ...options,
  });
  return { patch, previews, screen };
}

test('previews and confirms the chosen layout and feature toggles', async () => {
  const config = normalizeConfig({ display: { showAgents: true, showSessionName: true } });
  const { patch, previews, screen } = await run('2\n1,2 3\ny\n', { config, customStatusline: true });
  assert.deepEqual(patch, { lineLayout: 'compact', display: { showTools: true, showAgents: false }, gitStatus: { showFileStats: true } });
  assert.deepEqual(previews, [patch]);
  assert.equal(config.display.showAgents, true);
  assert.equal(config.display.showSessionName, true);
  assert.match(screen, /Expanded \(current\)/);
  assert.match(screen, /\[x\] Subagents/);
  assert.match(screen, /\[candidate HUD\][\s\S]+replace your custom agy statusline[\s\S]+enable AGY Hub/);
});

test('keeps the current layout and features on Enter and uses the configure-only prompt', async () => {
  const config = normalizeConfig({ language: 'zh-TW', lineLayout: 'compact', gitStatus: { showFileStats: true } });
  const { patch, screen } = await run('\n\n是\n', { config, configureOnly: true, customStatusline: true });
  assert.deepEqual(patch, {});
  assert.match(screen, /緊湊 \(目前\)/);
  assert.match(screen, /\[x\] Git 變更統計/);
  assert.match(screen, /儲存這些設定/);
  assert.doesNotMatch(screen, /替換|啟用/);
});

test('accepts Chinese delimiters and retries invalid choices without applying a partial selection', async () => {
  const config = normalizeConfig({ language: 'zh-Hans' });
  const { patch, previews, screen } = await run('9\n1\n1,4\n1、1，3\nmaybe\nyes\n', { config });
  assert.deepEqual(patch, { display: { showTools: true }, gitStatus: { showFileStats: true } });
  assert.deepEqual(previews, [patch]);
  assert.equal([...screen.matchAll(/请输入列表中的选项/g)].length, 3);
});

test('shows hidden activity and disabled Git statistics as off before enabling them', async () => {
  const config = normalizeConfig({
    elementOrder: ['project', 'context', 'usage'],
    display: { showTools: true }, gitStatus: { enabled: false, showFileStats: true },
  });
  const { patch, screen } = await run('\n1,3\ny\n', { config });
  assert.match(screen, /\[ \] Tool activity/);
  assert.match(screen, /\[ \] Git file stats/);
  assert.deepEqual(patch, { display: { showTools: true }, gitStatus: { showFileStats: true, enabled: true } });
});

test('cancels on q, EOF or default no without returning edits', async () => {
  const early = await run('q\n');
  assert.deepEqual(early.previews, []);
  assert.equal(early.patch, null);
  for (const answers of ['2\n1\n', '2\n1\nq\n', '2\n1\n\n']) {
    const result = await run(answers);
    assert.equal(result.patch, null);
    assert.equal(result.previews.length, 1);
    assert.match(result.screen, /Setup canceled/);
  }
});
