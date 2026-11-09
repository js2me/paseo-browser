import { mkdir, readFile, writeFile, lstat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const source = await readFile(new URL('../agent-skills/paseo-browser/SKILL.md', import.meta.url), 'utf8');
const marker = '<!-- Managed by paseo-browser plugin. -->';
const destinationIndex = process.argv.indexOf('--destination');
const explicit = destinationIndex >= 0 ? process.argv[destinationIndex + 1] : undefined;
if (destinationIndex >= 0 && !explicit) throw new Error('--destination requires a path');
const destination = resolve(explicit ?? join(homedir(), '.agents/skills/paseo-browser'));
const file = join(destination, 'SKILL.md');
try {
  const previous = await readFile(file, 'utf8');
  if (!previous.includes(marker)) throw new Error(`Preserving an existing user-authored skill at ${file}`);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(destination, { recursive: true });
await writeFile(file, source);
if (!explicit) {
  const codexRoot = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const codexPath = join(codexRoot, 'skills/paseo-browser');
  if (resolve(codexPath) !== destination) {
    try { await lstat(codexPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(join(codexRoot, 'skills'), { recursive: true });
      await symlink(destination, codexPath, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
}
console.log(`Installed Paseo Browser agent skill: ${destination}`);
