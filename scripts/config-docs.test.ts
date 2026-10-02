/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { CONTROL_NAMES, resolveControls } from './update-data';

// Documentation parity for the checked-in configuration. The control keys, the
// override precedence and the workflow invariants themselves are pinned in
// scripts/update-data.test.ts; this file only adds the coverage that suite does
// not have: README.md must document exactly the controls the implementation
// reads, with the real defaults, and `--help` must print them from the config
// file no matter which directory the updater runs from.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;
const readme = read('README.md');

// Defaults the README renders in prose instead of repeating the raw value.
const documentedAs: Record<string, string> = { TICKERS: 'all', SEC_UA: 'declared UA' };

describe('README update-controls table', () => {
  const rows = readme
    .slice(readme.indexOf('| Environment variable |'))
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => /^\| `([A-Z0-9_]+)` \| (.*?) \| /.exec(line)!);

  test('every canonical control is documented exactly once', () => {
    expect(rows.map(([, name]) => name).sort()).toEqual([...CONTROL_NAMES].sort());
    expect(readme).toContain('[scripts/update-data.config.json](scripts/update-data.config.json)');
  });

  test('each documented default equals the checked-in config value', () => {
    for (const [, name, shown] of rows) {
      expect(shown).toBe(documentedAs[name] ?? `\`${file[name]}\``);
    }
  });

  test('the documented advanced JSON example only names real controls and resolves', () => {
    const example = /advanced: '(\{.*?\})'/.exec(readme)![1].replace(/\\"/g, '"');
    const overrides = JSON.parse(example) as Record<string, string>;
    expect(Object.keys(overrides).length).toBeGreaterThan(0);
    for (const key of Object.keys(overrides)) expect(CONTROL_NAMES).toContain(key);
    expect(resolveControls(file, overrides)).toMatchObject(overrides);
  });
});

describe('README shared structure', () => {
  test('required headings in order and an honest, still-pending deployment claim', () => {
    const headings = [...readme.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,3} (.*)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Sprott', 'Using Bun', 'Updating the static Sprott data', 'Data sources', 'Update controls',
      'Examples', 'TypeScript', 'Brands table', 'Sibling applications', 'License',
    ]);
    expect(readme).toMatch(/deployment is pending/i);
    expect(readme).toMatch(/not affiliated with, endorsed by, or sponsored by Sprott/);
    for (const command of [
      'bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts',
      'bun build app.tsx', 'git diff --check',
    ]) {
      expect(readme).toContain(command);
    }
  });

  test('Sprott appears once in each shared table and the brand table stays sorted', () => {
    const brands = [...readme.matchAll(/^\| \*\*(.+?)\*\* \|/gm)].map((m) => m[1]);
    expect(brands).toContain('Sprott');
    expect(brands.filter((brand) => brand === 'Sprott')).toHaveLength(1);
    expect([...brands].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))).toEqual(brands);
    expect(readme.match(/^\| Sprott \|/gm)).toHaveLength(1);
    expect(readme).toContain('[Sprott](https://github.com/daggerok/Sprott)');
  });

  test('the linked live-acceptance evidence exists on disk', () => {
    const link = /\((scripts\/fixtures\/[^)]*live-acceptance[^)]*)\)/.exec(readme)![1];
    expect(readFileSync(new URL(`../${link}`, import.meta.url), 'utf8')).toMatch(/live acceptance/i);
  });
});

describe('updater CLI documentation', () => {
  test('--help prints every control from the checked-in config, independent of the cwd', async () => {
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], {
      cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe',
    });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) expect(help).toContain(name);
    expect(help).toContain(`SEC_UA=${file.SEC_UA}`);
  });

  test('the SEC_UA default is an identifying contact, never a credential', () => {
    expect(file.SEC_UA).toMatch(/^daggerok Sprott ETF feed \(https:\/\/github\.com\/daggerok\/sprott\)$/);
    expect(file.SEC_UA).not.toMatch(/@/);
    expect(readme).toContain('Do not put credentials here');
  });
});
