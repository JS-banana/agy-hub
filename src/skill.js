// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readTextFile } from './runtime/text-file.js';
import { cliCommand } from './setup.js';

const bundledSkill = new URL('../skills/agy-hud/SKILL.md', import.meta.url);
const fingerprint = /\n<!-- AGY HUD installed SHA-256: ([a-f0-9]{64}) -->\n$/;

/** @param {string} text */
const digest = (text) => createHash('sha256').update(text).digest('hex');

/** @param {string} installed @param {string} bundled */
function isManaged(installed, bundled) {
  if (installed === bundled) return true;
  const marker = fingerprint.exec(installed);
  return marker !== null && digest(installed.slice(0, marker.index)) === marker[1];
}

/** @param {string} path */
async function readInstalled(path) {
  const info = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.size > 128 * 1024) throw new Error(`The existing skill at ${path} is custom or modified. AGY HUD left it in place.`);
  return readTextFile(path, 128 * 1024)?.text ?? null;
}

/** @param {string} action */
export async function manageSkill(action, home = homedir()) {
  const path = join(home, '.gemini', 'antigravity-cli', 'skills', 'agy-hud', 'SKILL.md');
  if (action === 'path') return path;
  if (action !== 'install' && action !== 'uninstall') throw new Error('Use agy-hud skill install, uninstall, or path.');
  const content = await readFile(bundledSkill, 'utf8');
  const commandBlock = cliCommand().split('\n').map((line) => '    ' + line).join('\n');
  const body = `${content.trimEnd()}\n\n## Installed command\n\n${commandBlock}\n`;
  const installed = `${body}\n<!-- AGY HUD installed SHA-256: ${digest(body)} -->\n`;
  const existing = await readInstalled(path);
  if (existing !== null && !isManaged(existing, content)) {
    throw new Error(`The existing skill at ${path} is custom or modified. AGY HUD left it in place.`);
  }
  async function verifySkill() {
    if (await readInstalled(path) !== existing) throw new Error(`The skill at ${path} changed during setup. Try again.`);
  }
  if (action === 'uninstall') {
    if (existing === null) return 'The /agy-hud skill is not installed.';
    await verifySkill();
    await unlink(path);
    await rmdir(dirname(path)).catch((error) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
    return 'Removed the /agy-hud skill. Open a new agy session to reload skills.';
  }
  if (existing === installed) return 'The /agy-hud skill is already installed.';
  const folder = dirname(path);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temp = join(folder, `.agy-hud-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, installed, { flag: 'wx', mode: 0o600 });
    if (existing === null) await link(temp, path);
    else {
      await verifySkill();
      await rename(temp, path);
    }
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  const operation = existing === null ? 'Installed' : 'Updated';
  return `${operation} the /agy-hud skill. Open a new agy session, or run /skills reload in the interactive CLI.`;
}
