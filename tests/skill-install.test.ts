import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
test('skill preparation updates managed guidance and preserves user-authored skills', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paseo-browser-skill-'));
  const script = resolve('server/install-agent-skill.mjs');
  const file = join(directory, 'SKILL.md');
  try {
    await execute(process.execPath, [script, '--destination', directory]);
    const expected = await readFile(file, 'utf8');
    assert.match(expected, /name: paseo-browser/);
    assert.match(expected, /CUA/);
    await writeFile(file, '<!-- Managed by paseo-browser plugin. -->\nold guidance');
    await execute(process.execPath, [script, '--destination', directory]);
    assert.equal(await readFile(file, 'utf8'), expected);
    await writeFile(file, 'My personal browser skill');
    await assert.rejects(execute(process.execPath, [script, '--destination', directory]), /Preserving an existing user-authored skill/);
    assert.equal(await readFile(file, 'utf8'), 'My personal browser skill');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
