/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The client is a byte-copy of the pinned sibling with only the enumerated
// Sprott substitutions (see .worklog.txt). These tests pin the substitutions
// that must never regress plus the mandated count-badge hover/focus panel.
const app = readFileSync(new URL('../app.tsx', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const both = `${app}\n${html}`;

describe('Sprott client substitutions', () => {
  test('every static API path points at ./api/sprott', () => {
    const paths = [...both.matchAll(/\.\/api\/[A-Za-z0-9_./-]+/g)].map((match) => match[0]);
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) expect(path.startsWith('./api/sprott/')).toBe(true);
    expect(both).not.toMatch(/\/api\/(?!sprott\/)[a-z]/i);
  });

  test('localStorage keys and the export filename carry the Sprott prefix', () => {
    const keys = [...app.matchAll(/const [A-Z_]+_KEY = '([^']+)'/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) expect(key.startsWith('sprott-')).toBe(true);
    expect(html).toContain("localStorage.getItem('sprott-theme')");
    expect(app).toContain('`sprott-${scope.toLowerCase()');
  });

  test('the dividend-frequency fallback renders 00 - None', () => {
    expect(app).toContain("return '00 - None'");
    expect(app).not.toContain('00 - —');
  });

  test('user-facing attribution names the Sprott trust, CIK and site', () => {
    expect(app).toContain('SPROTT FUNDS TRUST, CIK 0001728683');
    expect(html).toContain('SPROTT FUNDS TRUST, CIK 0001728683');
    expect(app).toContain('https://sprottetfs.com/');
    expect(html).toContain('https://sprottetfs.com/');
  });

  test('the header count badge owns the hover/focus catalog panel', () => {
    expect(html).toContain('id="app-summary"');
    expect(html).toContain('aria-controls="app-summary"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/id="app-summary"[^>]*hidden/);
    expect(html).toContain("trigger.addEventListener('pointerenter'");
    expect(html).toContain("trigger.addEventListener('focus', show)");
    expect(html).toContain("panel.addEventListener('focusin', show)");
    expect(app).toContain("document.getElementById('app-summary')");
  });
});
