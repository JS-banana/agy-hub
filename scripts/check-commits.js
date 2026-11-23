import { readFileSync } from 'node:fs';

const header = /^[a-z][a-z0-9-]*(?:\([^()\s]+(?: +[^()\s]+)*\))?!?: \S[^\r\n]*$/i;
const [mode, value] = process.argv.slice(2);

let subjects;
switch (mode) {
  case '--message-file':
    subjects = [readFileSync(value, 'utf8').split(/\r?\n/).find((line) => line.trim()) ?? ''];
    break;
  case '--title':
    subjects = [value ?? ''];
    break;
  case '--subjects':
    subjects = readFileSync(0, 'utf8').split('\0');
    if (subjects.at(-1) === '') subjects.pop();
    break;
  default:
    process.stderr.write('Usage: node scripts/check-commits.js --message-file <path> | --title <title> | --subjects\n');
    process.exit(2);
}

const invalid = subjects.filter((subject) => !header.test(subject));
if (invalid.length) {
  for (const subject of invalid) process.stderr.write(`Invalid Conventional Commit subject: ${JSON.stringify(subject)}\n`);
  process.stderr.write('Expected type(scope)!: description, for example feat(hud): show session cost. Scope and ! are optional.\n');
  process.exitCode = 1;
}
