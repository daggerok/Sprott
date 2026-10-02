/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, resolveControls } from './update-data';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;
const readme = read('README.md');
const updateWorkflow = read('.github/workflows/update-data.yml');
const checksWorkflow = read('.github/workflows/checks.yml');
const pagesWorkflow = read('.github/workflows/pages.yml');

describe('README and CLI config documentation parity', () => {
  test('README controls table rows match scripts/update-data.config.json keys and defaults', () => {
    const section = readme.slice(readme.indexOf('### Update controls'), readme.indexOf('### Examples'));
    const rows = section
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => /^\| `([A-Z0-9_]+)` \| (.*?) \| /.exec(line)!);

    expect(rows.map((match) => match[1]).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const [, name, shown] of rows) {
      const value = String(file[name]);
      const expected = name === 'TICKERS' && value === ''
        ? 'all'
        : name === 'SEC_UA'
          ? 'declared UA'
          : `\`${value}\``;
      expect(shown).toBe(expected);
    }
    expect(readme).toContain('scripts/update-data.config.json');
  });

  test('--help prints every canonical control from scripts/update-data.config.json', async () => {
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const help = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    for (const name of CONTROL_NAMES) {
      expect(help).toContain(name);
    }
  });
});

describe('README standard structure and shared tables', () => {
  test('headings, pending deployment notice, trademark disclaimer and verification commands are present', () => {
    const headings = [...readme.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,3} (.*)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      'Sprott',
      'Using Bun',
      'Updating the static Sprott data',
      'Data sources',
      'Update controls',
      'Examples',
      'TypeScript',
      'Brands table',
      'Sibling applications',
      'License',
    ]);
    expect(readme).toContain('Deployment is pending');
    expect(readme).toMatch(/not affiliated with, endorsed by, or sponsored by Sprott Inc\./);
    for (const command of [
      'bun install --frozen-lockfile',
      'bun test',
      'bun build --target=bun scripts/update-data.ts',
      'bun build app.tsx',
      'git diff --check',
    ]) {
      expect(readme).toContain(command);
    }
  });

  test('Sprott row appears once in both shared brand tables', () => {
    expect(readme.match(/^\| \*\*Sprott\*\* \|/gm)?.length).toBe(1);
    expect(readme.match(/^\| Sprott \|/gm)?.length).toBe(1);
  });
});

describe('workflow dispatch and deployment guards', () => {
  const inputsBlock = updateWorkflow.slice(updateWorkflow.indexOf('    inputs:'), updateWorkflow.indexOf('\npermissions:'));
  const inputNames = [...inputsBlock.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]);
  const advancedOnly = ['SEC_UA', 'SKIP_SPROTT', 'STORE_RAW_DOWNLOADS', 'VERBOSE'];

  test('every control is either a named dispatch input or one of the four advanced-only controls', () => {
    const individual = new Set(inputNames.filter((name) => name !== 'advanced').map((name) => name.toUpperCase()));
    for (const name of individual) {
      expect(CONTROL_NAMES).toContain(name as (typeof CONTROL_NAMES)[number]);
    }
    const rest = CONTROL_NAMES.filter((name) => !individual.has(name));
    expect([...rest].sort()).toEqual(advancedOnly);
    for (const name of rest) {
      expect(() => resolveControls(file, { [name]: name === 'SEC_UA' ? 'ops contact' : 'true' })).not.toThrow();
    }
  });

  test('workflows avoid raw input interpolation, stage only api/sprott and guard Pages to main', () => {
    expect(updateWorkflow).toContain('DISPATCH_INPUTS: ${{ toJSON(inputs) }}');
    expect(updateWorkflow).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
    expect([...updateWorkflow.matchAll(/git add (\S+)/g)].map((match) => match[1])).toEqual(['api/sprott']);
    expect(checksWorkflow).toContain('persist-credentials: false');
    expect(pagesWorkflow).toContain('persist-credentials: false');
    expect(pagesWorkflow).toContain("if: github.ref == 'refs/heads/main'");
  });
});
