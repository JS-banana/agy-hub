import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const bundledSkill = new URL('../skills/agy-hub/SKILL.md', import.meta.url);

export async function manageSkill(action, home = homedir()) {
  const path = join(home, '.gemini', 'antigravity-cli', 'skills', 'agy-hub', 'SKILL.md');
  if (action === 'path') return path;
  if (action !== 'install' && action !== 'uninstall') throw new Error('Use agy-hub skill install, uninstall, or path.');
  const content = await readFile(bundledSkill);
  const existing = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    if (!existing.isFile() || existing.size !== content.length || !content.equals(await readFile(path))) {
      throw new Error(`The existing skill at ${path} is custom or modified. AGY Hub left it in place.`);
    }
    if (action === 'install') return 'The /agy-hub skill is already installed.';
    await unlink(path);
    return 'Removed the /agy-hub skill. Open a new agy session to reload skills.';
  }
  if (action === 'uninstall') return 'The /agy-hub skill is not installed.';
  const folder = dirname(path);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temp = join(folder, `.agy-hub-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await link(temp, path);
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return 'Installed the /agy-hub skill. Open a new agy session, or run /skills reload in the interactive CLI.';
}
