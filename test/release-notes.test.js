import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/release-notes.js', import.meta.url));
const changelog = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
const compare = 'https://github.com/JS-banana/agy-hud/compare/';

const sample = [
  '# Changelog', '',
  '## [Unreleased]', '',
  '### Fixed', '',
  '- Upcoming fix', '',
  '## [0.5.0] - 2026-11-24', '',
  '### Added', '',
  '- New option', '',
  '### Fixed', '',
  '- Quota countdown color', '',
  '## [0.4.0] - 2026-11-20', '',
  '### Added', '',
  '- Initial status line', '',
  `[Unreleased]: ${compare}v0.5.0...HEAD`,
  `[0.5.0]: ${compare}v0.4.0...v0.5.0`,
  '[0.4.0]: https://github.com/JS-banana/agy-hud/releases/tag/v0.4.0',
].join('\n');

function releaseNotes(context, tag, text = sample) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agy-hud-release-notes-')));
  const file = join(dir, 'CHANGELOG.md');
  context.after(() => rmSync(dir, { force: true, recursive: true }));
  writeFileSync(file, text);
  return spawnSync(process.execPath, [script, tag, file], { encoding: 'utf8' });
}

test('publishes the notes of a released version with a link to its full change set', (context) => {
  const result = releaseNotes(context, 'v0.5.0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '### Added\n\n- New option\n\n### Fixed\n\n- Quota countdown color'
    + `\n\n**Full Changelog**: ${compare}v0.4.0...v0.5.0\n`);
});

test('uses the unreleased notes for a prerelease tag without a link that would stop matching it', (context) => {
  const result = releaseNotes(context, 'v0.6.0-rc.1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '### Fixed\n\n- Upcoming fix\n');
});

test('leaves the first release without a full changelog link because no earlier tag exists', (context) => {
  const result = releaseNotes(context, 'v0.4.0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '### Added\n\n- Initial status line\n');
});

test('rejects a release that the changelog does not describe or date', (context) => {
  const missing = releaseNotes(context, 'v0.6.0');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /has no entry for v0\.6\.0\. Add '## \[0\.6\.0\] - YYYY-MM-DD', or rename '## \[Unreleased\]'/);

  const empty = releaseNotes(context, 'v0.6.0-rc.1', sample.replace('- Upcoming fix', ''));
  assert.equal(empty.status, 1, 'Subsection headings without entries are not release notes');
  assert.match(empty.stderr, /has no entry for v0\.6\.0-rc\.1\. Describe it under '## \[Unreleased\]'/);

  const blank = releaseNotes(context, 'v0.6.0-rc.1', sample.replace('## [Unreleased]\n\n### Fixed\n\n- Upcoming fix', '## [Unreleased]'));
  assert.equal(blank.status, 1, 'A section without any content is not release notes');

  const undated = releaseNotes(context, 'v0.5.0', sample.replace('## [0.5.0] - 2026-11-24', '## [0.5.0]'));
  assert.equal(undated.status, 1);
  assert.match(undated.stderr, /has no release date for v0\.5\.0\. Use '## \[0\.5\.0\] - YYYY-MM-DD'\./);

  for (const result of [missing, empty, blank, undated]) assert.equal(result.stdout, '', 'A rejected release must not produce notes');
});

test('preserves inline reference links while isolating yanked and non-version sections', (context) => {
  const text = [
    '# Changelog', '',
    '## [Unreleased]', '',
    '- Upcoming item', '',
    '## [0.5.0] - 2026-11-24 [YANKED]', '',
    '### Fixed', '',
    '- Yanked fix, see [docs]', '',
    '[docs]: https://example.com/docs', '',
    '## Notes', '',
    '- Trailing note that does not belong to 0.5.0', '',
    `[Unreleased]: ${compare}v0.5.0...HEAD`,
    `[0.5.0]: ${compare}v0.4.0...v0.5.0`,
  ].join('\n');
  const result = releaseNotes(context, 'v0.5.0', text);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    '### Fixed\n\n- Yanked fix, see [docs]\n\n[docs]: https://example.com/docs'
      + `\n\n**Full Changelog**: ${compare}v0.4.0...v0.5.0\n`,
  );
});

test('rejects duplicate version headings', (context) => {
  const duplicated = `${sample}\n## [0.5.0] - 2026-11-25\n\n- Duplicate\n`;
  const result = releaseNotes(context, 'v0.5.0', duplicated);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /duplicate entries for 0\.5\.0/);
});

test('the repository changelog starts with Unreleased and dates and links every release', () => {
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - (\S+))?\r?$/gm)].map(([, name, date]) => ({ name, date }));
  assert.equal(headings[0]?.name, 'Unreleased');
  assert.equal(headings[0].date, undefined);
  assert.ok(changelog.includes('[Unreleased]: '), 'Unreleased needs a link reference');
  for (const { name, date } of headings.slice(1)) {
    assert.match(date ?? '', /^\d{4}-\d{2}-\d{2}$/, `${name} needs an ISO release date`);
    assert.ok(changelog.includes(`[${name}]: `), `${name} needs a link reference`);
    const result = spawnSync(process.execPath, [script, `v${name}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim(), `${name} has no notes`);
  }

  // The package version must be releasable: documented under its own section or still under Unreleased.
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const exitCode = (tag) => spawnSync(process.execPath, [script, tag], { encoding: 'utf8' }).status;
  assert.ok(exitCode(`v${version}`) === 0 || exitCode(`v${version}-rc.1`) === 0, `CHANGELOG.md must describe v${version}`);
});
