/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json'));
const readme = read('README.md');
const workflowText = read('.github/workflows/update-data.yml');
const workflow = Bun.YAML.parse(workflowText) as any;
const inputsBlock = workflowText.slice(workflowText.indexOf('    inputs:'), workflowText.indexOf('\npermissions:'));
const inputNames = [...inputsBlock.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
const advancedOnly = ['SEC_UA', 'STORE_RAW_DOWNLOADS', 'VERBOSE'];

describe('resolveControls layering', () => {
  test('precedence: file < advanced < nonblank input < environment (brand alias wins)', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'URNM' }, { CONCURRENCY: 3, TICKERS: 'SGDM' }, { CONCURRENCY: '4', TICKERS: '' }, { SPROTT_CONCURRENCY: '5', CONCURRENCY: '6' });
    expect(c).toEqual({ CONCURRENCY: '5', TICKERS: 'SGDM' });
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('blank input inherits the file value; advanced can clear a key deliberately', () => {
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
    const c = resolveControls(file, {}, {}, {});
    expect(c).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
    for (const value of Object.values(c)) expect(typeof value).toBe('string');
  });

  test('invalid JSON shapes, unknown keys, non-scalars and control characters are rejected', () => {
    for (const bad of [{ UNKNOWN: 1 }, { SEC_YIELD: '1:2' }, { TICKERS: ['URNM'] }, { TICKERS: { a: 1 } }, { TICKERS: null }, null, [], 'x', 1]) {
      expect(() => resolveControls(bad as any)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\nEVIL=yes' })).toThrow();
    expect(() => resolveControls({}, {}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { SPROTT_SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, [] as any)).toThrow();
    expect(() => JSON.parse('{oops')).toThrow();
  });

  test('per-control validation is kept', () => {
    for (const bad of [{ CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { SKIP_SPROTT: 'perhaps' }, { AUM: '1:2:3' }, { TER: 'a:b' }, { PERFORMANCE_1Y: '5' }, { TOTAL_RETURN_3Y: '9:1' }]) {
      expect(() => resolveControls(bad)).toThrow();
    }
  });
});

describe('sprott defaults and docs parity', () => {
  test('provider-specific default values', () => {
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.concurrency).toBe(2);
    expect(file.REQUEST_SLEEP).toBe('1');
    expect(file.HISTORY_RANGE).toBe('max');
    expect(file.HOLDINGS_PAGE_SIZE).toBe('250');
    expect(file.HISTORY_PAGE_SIZE).toBe('1000');
    expect(file.EDGAR_FALLBACK).toBe('true');
    expect(file.SKIP_SPROTT).toBe('false');
    expect(file.SKIP_YAHOO).toBe('false');
    expect(file.SEC_UA).toBe('daggerok Sprott ETF feed (https://github.com/daggerok/Sprott)');
    expect(file.SEC_UA).not.toMatch(/@/);
  });

  test('config values are strings and keys equal CONTROL_NAMES', () => {
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    expect(CONTROL_NAMES.length).toBe(27);
    expect(new Set(CONTROL_NAMES).size).toBe(CONTROL_NAMES.length);
  });

  test('README controls table rows equal the config keys exactly', () => {
    const table = readme.slice(readme.indexOf('| Environment variable |'));
    const rows = table.split('\n').filter((line) => line.startsWith('| `')).map((line) => /^\| `([A-Z0-9_]+)` \| (.*?) \| /.exec(line)!);
    expect(rows.map((m) => m[1]).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const [, name, shown] of rows) {
      const value = String(file[name]);
      expect(shown).toBe(value === '' ? 'empty (all)' : '`' + value + '`');
    }
    expect(readme).toContain('scripts/update-data.config.json');
  });

  test('--help covers every control', async () => {
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) expect(help).toContain(name);
  });

  test('runtimeControls reads the file and lets the environment win', async () => {
    expect((await runtimeControls({})).CONCURRENCY).toBe(file.CONCURRENCY);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    expect((await runtimeControls({ SPROTT_TICKERS: 'URNM' })).TICKERS).toBe('URNM');
  });
});

describe('README standard structure', () => {
  test('required headings in order, deployment pending, disclaimer, verification commands', () => {
    const headings = [...readme.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,3} (.*)$/gm)].map((m) => m[1]);
    const order = ['Sprott', 'Using Bun', 'Updating the static Sprott data', 'Data sources', 'Metrics and caveats', 'Update controls', 'Examples', 'TypeScript and verification', 'Brands table', 'Sibling applications', 'License'];
    expect(headings).toEqual(order);
    expect(readme).toContain('deployment is pending');
    expect(readme).toMatch(/not affiliated with, endorsed by, or sponsored by Sprott/);
    for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) expect(readme).toContain(command);
  });
  test('Sprott rows exist once in both shared tables', () => {
    expect(readme.match(/\*\*Sprott ETFs\*\*/g)?.length).toBe(1);
    expect(readme.match(/^\| Sprott ETFs \|/gm)?.length).toBe(1);
  });
});

describe('workflow', () => {
  test('inputs: at most 25, advanced defaults to {}, every individual input is a control', () => {
    expect(inputNames.length).toBeLessThanOrEqual(25);
    expect(inputNames).toContain('advanced');
    expect(inputsBlock).toMatch(/advanced:[\s\S]*?default: '\{\}'/);
    for (const name of inputNames.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
    expect(inputNames).toContain('concurrency');
    expect(inputNames).toContain('tickers');
  });

  test('every control is an individual input or reachable through advanced and the config file', () => {
    const individual = new Set(inputNames.filter((n) => n !== 'advanced').map((n) => n.toUpperCase()));
    const rest = CONTROL_NAMES.filter((name) => !individual.has(name));
    expect([...rest].sort()).toEqual([...advancedOnly].sort());
    for (const name of rest) expect(() => resolveControls(file, { [name]: name === 'SEC_UA' ? 'x' : 'true' })).not.toThrow();
    expect(workflow.on.workflow_dispatch.inputs.advanced.default).toBe('{}');
  });

  test('schedule, fixed output dir and no direct inputs interpolation', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '0 0 * * 0' }]);
    expect(workflow.on).not.toHaveProperty('push');
    expect(workflowText).toContain('toJSON(inputs)');
    expect(workflowText).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
    expect(workflowText).not.toContain('OUTPUT_DIR');
    expect(workflowText).toContain('git add api/sprott\n          if git diff --cached --quiet -- api/sprott');
    expect([...workflowText.matchAll(/git add (\S+)/g)].map((m) => m[1])).toEqual(['api/sprott']);
    expect(workflowText).toContain('name: Update Sprott ETF data');
    expect(workflowText).not.toMatch(/bunx|tsc/);
  });

  test('protected SEC_UA variable wins only when nonblank and is never an input', () => {
    expect(workflowText).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(inputNames).not.toContain('sec_ua');
    expect(workflowText).toContain('if ((process.env.PROTECTED_SEC_UA ?? "").trim())');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, {}).SEC_UA).toBe('advanced');
  });

  test('the Actions resolver step applies the same layers as the local CLI', () => {
    const step = (workflow.jobs['update-data'].steps as any[]).find((s) => s.name === 'Resolve file defaults and manual overrides');
    expect(step.run).toContain('resolveControls(file, advanced, individual, protectedVars)');
    expect(step.env.DISPATCH_INPUTS).toBe('${{ toJSON(inputs) }}');
  });
});
