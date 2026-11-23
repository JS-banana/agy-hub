import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A GitHub Release documents the matching CHANGELOG.md section, so the two cannot drift apart.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = (process.argv[2] ?? `v${version}`).replace(/^v/, '');
const changelog = readFileSync(process.argv[3] ?? fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

const sections = new Map();
const links = new Map();
let section;
for (const line of changelog.split(/\r?\n/)) {
  const heading = /^## \[([^\]]+)\](?: - (\S+))?\s*$/.exec(line);
  const link = /^\[([^\]]+)\]: (\S+)\s*$/.exec(line);
  if (heading) {
    section = { date: heading[2] ?? '', lines: [] };
    sections.set(heading[1], section);
  } else if (link) {
    links.set(link[1], link[2]);
  } else {
    section?.lines.push(line);
  }
}

const released = sections.get(tag);
const entry = released ?? (/-/.test(tag) ? sections.get('Unreleased') : undefined);
const notes = entry?.lines.join('\n').trim();
// A section that only kept its subsection headings documents nothing.
const documented = entry?.lines.some((line) => line.trim() && !line.startsWith('#'));
const expected = `## [${tag}] - YYYY-MM-DD`;
if (!documented) {
  const guidance = /-/.test(tag) ? `Describe it under '## [Unreleased]' or add '${expected}'`
    : `Add '${expected}', or rename '## [Unreleased]' to it in the release PR`;
  process.stderr.write(`CHANGELOG.md has no entry for v${tag}. ${guidance}.\n`);
  process.exitCode = 1;
} else if (released && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
  process.stderr.write(`CHANGELOG.md has no release date for v${tag}. Use '${expected}'.\n`);
  process.exitCode = 1;
} else {
  const [base, head] = links.get(tag)?.split('/compare/')[1]?.split('...') ?? [];
  const fullChangelog = base?.startsWith('v') && head === `v${tag}` ? `\n\n**Full Changelog**: ${links.get(tag)}` : '';
  process.stdout.write(`${notes}${fullChangelog}\n`);
}
