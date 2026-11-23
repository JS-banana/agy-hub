import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = `v${version}`;
const tag = process.argv[2] ?? expected;
const semverTag = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!semverTag.test(tag) || tag !== expected) {
  process.stderr.write(`Expected release tag ${expected} to match package.json, received ${JSON.stringify(tag)}.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${tag}\n`);
}
