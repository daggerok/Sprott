#!/usr/bin/env bun
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}

import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';

type JsonRecord = Record<string, any>;
const SPROTT_SITE = 'https://sprottetfs.com';
const SITEMAP_URL = `${SPROTT_SITE}/sitemap.xml`;
const CATALOG_PAGE = SITEMAP_URL;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';
// SPROTT FUNDS TRUST (confirmed 2026-09-28: CIK 0001728683). Used only when
// the SEC ticker table does not resolve this ETF's registrant by itself.
const SPROTT_TRUST_CIK = '0001728683';
const API_ROOT = new URL('../api/sprott/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);
// Workflow timeout is 30 min: stop starting funds after 25 min, then still write the index.
const SOFT_DEADLINE_MS = 25 * 60 * 1000;
const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" / "Aug 21 2026" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column. Pure calendar text, never the local time zone (shared calendar-dates block).
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return calendarIso(text) ?? text;
}

// "2026-08-21" -> epoch seconds at UTC midnight (inverse of epochToIsoDate).
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  secUa: string;
  skipYahoo: boolean;
  skipSprott: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  for (const key of [`SPROTT_${name}`, name, ...aliases]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number, name = 'value'): number {
  if (raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name}: expected integer >= 1, got "${raw}"`);
  return Number(raw);
}

function parseNonNegativeFloat(raw: string, fallback: number, name = 'value'): number {
  if (raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name}: expected nonnegative number, got "${raw}"`);
  return value;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error('Range requires exactly one colon');
  const [rawMin, rawMax] = text.split(':', 2);
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) {
    const value=Number(suffixMatch[1])*(AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()]??1);
    if(!Number.isFinite(value))throw new Error(`AUM: invalid bound ${bound}`);
    return value;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`AUM: invalid bound ${bound}`);
  return value;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error('Range requires exactly one colon');
  const [rawMin, rawMax] = text.split(':', 2);
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), CONCURRENCY_FALLBACK, 'CONCURRENCY'),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), REQUEST_SLEEP_FALLBACK, 'REQUEST_SLEEP'),
    maxFetches: envValue(env, 'MAX_FETCHES', ['SPROTT_LIMIT']) === '0' ? 0 : parsePositiveInt(envValue(env, 'MAX_FETCHES', ['SPROTT_LIMIT']), 0, 'MAX_FETCHES'),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), HOLDINGS_PAGE_SIZE_FALLBACK, 'HOLDINGS_PAGE_SIZE'),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), HISTORY_PAGE_SIZE_FALLBACK, 'HISTORY_PAGE_SIZE'),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS', ['SPROTT_STORE_RAW_DOWNLOADS']), false),
    maxRetries: parsePositiveInt(envValue(env, 'MAX_RETRIES'), MAX_RETRIES_FALLBACK, 'MAX_RETRIES'),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO'), false),
    skipSprott: parseBoolean(envValue(env, 'SKIP_SPROTT'), false),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}
class HttpError extends Error {
  constructor(message: string, readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

export const FETCH_TIMEOUT_MS = 45_000;
export async function fetchWithRetry(
  url: string,
  label: string,
  init: RequestInit = {},
  maxRetries = 2,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...init });
      // Read the body inside the retry loop: the timeout signal covers headers AND body.
      if (response.ok) return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  const response = await fetchWithRetry(url, label, { headers }, config.maxRetries);
  return await response.text();
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

// adjCloseRaw: Yahoo's unrounded value, only used to tell float noise from a real change (never persisted).
export type ChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };

export type ParsedChart = {
  exchangeName: string;
  longName: string;
  navPrice: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      // Yahoo recomputes the split/dividend-adjusted close on every request;
      // at 6 decimals the last digit or two jitters between otherwise
      // identical requests, making every history row (and the fund) look
      // "updated" on every single run. 2 decimals is well past any
      // meaningful precision for a price and absorbs that jitter.
      adjClose: round(adjClose, 2),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
      adjCloseRaw: adjClose,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    navPrice: numberOrNull(meta.navPrice),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

function chartUrl(ticker: string, config: UpdaterConfig): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(Date.now() / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange);
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived catalog metrics (unit-tested helpers, sibling parity)
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the product list publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}

export function inferDistributionFrequency(
  dividends: Array<{ epoch: number; amount: number }>,
): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  const recent = dividends.slice(-9);
  if (recent.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const gapsDays: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = (recent[i].epoch - recent[i - 1].epoch) / 86_400;
    if (gap > 14 && gap < 400) gapsDays.push(gap);
  }
  if (!gapsDays.length) return { frequency: 'Unknown', paymentsPerYear: null };
  gapsDays.sort((a, b) => a - b);
  const medianGap = gapsDays[Math.floor(gapsDays.length / 2)];
  if (medianGap >= 300) return { frequency: 'Annually', paymentsPerYear: 1 };
  if (medianGap >= 150) return { frequency: 'Semi-annually', paymentsPerYear: 2 };
  if (medianGap >= 75) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (medianGap >= 25) return { frequency: 'Monthly', paymentsPerYear: 12 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type PriceReturns = {
  asOfDate: string;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  mo1: number | null;
  qtd: number | null;
};

const EMPTY_PRICE_RETURNS: PriceReturns = {
  asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null,
};

function pctChange(start: number, end: number): number {
  return round(((end - start) / start) * 100, 2);
}

function annualized(start: number, end: number, years: number): number | null {
  if (start <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

// Total returns from an adjusted daily series anchored to the last trading day
// at or before `now`. The series is the Yahoo adjusted market-price history
// (Sprott publishes official NAV returns on every fund page, so these only
// fill the gaps and drive the History-derived blocks).
export function priceReturns(days: ChartDay[], now = new Date(), coveredFrom: string | null = null): PriceReturns {
  const empty: PriceReturns = { ...EMPTY_PRICE_RETURNS };
  if (!days.length) return empty;
  const last = days[days.length - 1];
  // A window is derivable only when its anchor day lies inside the span the
  // adjusted series covers (see reinvestmentCoverageStart).
  const anchored = (day: ChartDay | null): day is ChartDay => day !== null && day.date < last.date && (coveredFrom === null || day.date >= coveredFrom);
  const lastEpoch = Date.parse(`${last.date}T00:00:00Z`) / 1000;
  const atOrBefore = (iso: string): ChartDay | null => {
    const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
    if (Number.isNaN(target)) return null;
    let found: ChartDay | null = null;
    for (const day of days) {
      if (Date.parse(`${day.date}T00:00:00Z`) / 1000 <= target) found = day;
      else break;
    }
    return found;
  };
  const yearsAgo = (years: number): ChartDay | null => {
    const date = new Date(now.getTime());
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return atOrBefore(date.toISOString().slice(0, 10));
  };
  const ytdStart = atOrBefore(`${now.getUTCFullYear()}-01-01`);
  const mo1Start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const quarterStart = `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year1 = yearsAgo(1);
  const year3 = yearsAgo(3);
  const year5 = yearsAgo(5);
  const year10 = yearsAgo(10);
  const first = days[0];
  const siYears = (lastEpoch - Date.parse(`${first.date}T00:00:00Z`) / 1000) / (365.25 * 86_400);
  const mo1StartDay = atOrBefore(mo1Start);
  const qtdStartDay = atOrBefore(quarterStart);
  return {
    asOfDate: last.date,
    ytd: anchored(ytdStart) && ytdStart.adjClose > 0 ? pctChange(ytdStart.adjClose, last.adjClose) : null,
    yr1: anchored(year1) ? pctChange(year1.adjClose, last.adjClose) : null,
    cagr3y: anchored(year3) ? annualized(year3.adjClose, last.adjClose, 3) : null,
    cagr5y: anchored(year5) ? annualized(year5.adjClose, last.adjClose, 5) : null,
    cagr10y: anchored(year10) ? annualized(year10.adjClose, last.adjClose, 10) : null,
    siAnn: siYears >= 0.75 && anchored(first) ? annualized(first.adjClose, last.adjClose, siYears) : null,
    mo1: anchored(mo1StartDay) ? pctChange(mo1StartDay.adjClose, last.adjClose) : null,
    qtd: anchored(qtdStartDay) ? pctChange(qtdStartDay.adjClose, last.adjClose) : null,
  };
}

export function lastCompletedQuarterEnd(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (month <= 2) return new Date(Date.UTC(year - 1, 11, 31)); // Jan-Mar -> Dec 31
  if (month <= 5) return new Date(Date.UTC(year, 2, 31)); // Apr-Jun -> Mar 31
  if (month <= 8) return new Date(Date.UTC(year, 5, 30)); // Jul-Sep -> Jun 30
  return new Date(Date.UTC(year, 8, 30)); // Oct-Dec -> Sep 30
}

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function annualizedValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  if (period === 'YTD') return numberOrNull(metrics.ytd);
  if (period === '1Y') return numberOrNull(metrics.tr1y);
  return numberOrNull(metrics[`cagr${period.toLowerCase()}`]);
}

function cumulativeValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  const key = period === 'YTD' ? 'ytd' : period === '1Y' ? 'tr1y' : `tr${period.toLowerCase()}`;
  return numberOrNull(metrics[key]);
}

export function fundFilterReasons(
  candidate: { ticker: string; aumValue?: number | null; terValue?: number | null; metrics: JsonRecord },
  config: UpdaterConfig,
): string[] {
  const reasons: string[] = [];
  if (config.tickers.length && !config.tickers.includes(candidate.ticker)) reasons.push('TICKERS');
  if (config.aumRange && !inRange(candidate.aumValue ?? null, config.aumRange)) reasons.push('AUM');
  if (config.terRange && !inRange(candidate.terValue ?? null, config.terRange)) reasons.push('TER');
  if (config.dividendYieldRange && !inRange(numberOrNull(candidate.metrics.dividendYield), config.dividendYieldRange)) {
    reasons.push('DIVIDEND_YIELD');
  }
  if (!inRange(numberOrNull(candidate.metrics.secYield), config.secYieldRange)) reasons.push('SEC_YIELD');
  for (const period of RETURN_PERIODS) {
    const performance = config.performanceRanges[period];
    if (performance && !inRange(annualizedValue(candidate.metrics, period), performance)) reasons.push(`PERFORMANCE_${period}`);
    const total = config.totalReturnRanges[period];
    if (total && !inRange(cumulativeValue(candidate.metrics, period), total)) reasons.push(`TOTAL_RETURN_${period}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic writers (iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------
async function writePages(
  dir: URL,
  ticker: string,
  kind: 'holdings' | 'history',
  headers: string[],
  rows: JsonRecord[],
  pageSize: number,
): Promise<{ pages: string[]; pageSize: number; totalRows: number }> {
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  if (rows.length) {
    const pageCount = Math.ceil(rows.length / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const name = `${kind}/${pad3(page)}.json`;
      await writeIfChanged(new URL(name, dir), {
        ticker,
        page,
        pageSize,
        totalRows: rows.length,
        headers,
        rows: slice,
      });
      pages.push(name);
    }
  }
  return { pages, pageSize, totalRows: rows.length };
}

async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', kept: Set<string>): Promise<void> {
  const kindDir = new URL(`${kind}/`, fundDir);
  let entries: string[] = [];
  try {
    entries = await readdir(kindDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.json') && !kept.has(`${kind}/${entry}`)) {
      await rm(new URL(entry, kindDir), { force: true });
    }
  }
}
async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let page = 1;
  for (;;) {
    let payload: JsonRecord;
    try {
      payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(page)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    } catch {
      return rows;
    }
    rows.push(...(payload.rows || []));
    const totalRows = numberOrNull(payload.totalRows);
    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (!(payload.rows || []).length) return rows;
    page += 1;
  }
}

async function readPreviousSheetHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[]> {
  try {
    const payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(1)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fund assembly
// ---------------------------------------------------------------------------
function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({
    Date: formatEdgarDate(day.date),
    Close: String(day.close),
    'Adj Close': String(day.adjClose),
    Volume: String(day.volume),
  }));
}

// Array rows (not objects): meta.distributions feeds renderDistributionsTable
// directly, same as the sibling worksheet shape.
function distributionRows(dividends: Array<{ epoch: number; amount: number }>): string[][] {
  return dividends.map((dividend) => [formatUsDate(dividend.epoch), String(round(dividend.amount, 6))]);
}


// Per-worker request lanes: sprottetfs.com, Yahoo and SEC are direct (no
// proxy), so each of the CONCURRENCY lanes paces its own request starts by
// REQUEST_SLEEP. A caller takes the lane that frees up first, so N workers give
// about N times the throughput of one. Reserve BEFORE awaiting (no races).
export function createRequestGate(concurrency: number, sleepMs: number, now = Date.now, wait = sleep): () => Promise<void> {
  const lanes = Array.from({ length: Math.max(1, concurrency) }, () => 0);
  return async () => {
    const time = now();
    let lane = 0;
    for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[lane]) lane = i;
    const delay = Math.max(0, lanes[lane] - time);
    lanes[lane] = Math.max(time, lanes[lane]) + Math.max(0, sleepMs);
    if (delay) await wait(delay);
  };
}
let paceRequests = createRequestGate(CONCURRENCY_FALLBACK, REQUEST_SLEEP_FALLBACK * 1000);
export function configureRequestPacing(concurrency: number, sleepMs: number): void {
  paceRequests = createRequestGate(concurrency, sleepMs);
}

/** Index content without the run stamps; a rerun with identical data must not move them. */
export function withoutStamps(index: unknown): unknown {
  if (!index || typeof index !== 'object') return index;
  const { generatedAt: _g, catalogReadAt: _c, ...rest } = index as JsonRecord;
  return rest;
}
export function isoSeconds(date = new Date()): string { return date.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
export function samePublishedContent(previous: string, value: unknown): boolean {
  try { return outputContentKey(JSON.parse(previous)) === outputContentKey(value); }
  catch { return false; }
}
async function readJson(file: URL): Promise<JsonRecord | null> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}
async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const previous = await readFile(file, 'utf8').catch(() => '');
  if (samePublishedContent(previous, value)) return false;
  await mkdir(new URL('./', file), { recursive: true });
  const temp = new URL(`${file.href}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 1) + '\n');
  await rename(temp, file);
  return true;
}
async function storeRaw(ticker: string, name: string, value: unknown, config: UpdaterConfig): Promise<void> {
  if (config.storeRawDownloads) await writeIfChanged(new URL(`raw/${ticker}/${name}.json`, API_ROOT), value);
}

/** ISO date of a calendar date text (a U.S. date may be followed by a time), or null; never the local time zone. */
export function isoDate(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return calendarIso(s) ?? (/^\d{1,2}\/\d{1,2}\/\d{4}\s/.test(s) ? calendarIso(s.split(/\s/)[0]) : null);
}
// ---------------------------------------------------------------------------
// Sprott provider adapter.
// sprottetfs.com serves complete, server-rendered fund pages (Umbraco):
//   * any fund page carries the fund navigation list with every Sprott ETF
//     (ticker, name, canonical URL) — that list is the catalog, discovered
//     through sitemap.xml so new funds appear without a code change;
//   * the pricing block, "Key Facts", the holdings table (plus the
//     "Download All Holdings" data-URI CSV), the distribution table and the
//     month-/quarter-end performance tables are all plain HTML on the page.
// Holdings fall back to SEC EDGAR N-PORT-P (SPROTT FUNDS TRUST) and price
// history/dividends fall back to Yahoo Finance; the last resort is the
// previously published data.
// ---------------------------------------------------------------------------

/** Decodes the HTML entities the Umbraco pages actually emit. */
export function decodeEntities(value: unknown): string {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

export function stripHtml(value: unknown): string {
  return decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagAttribute(tag: string, name: string): string | null {
  const doubleQuoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  if (doubleQuoted) return decodeEntities(doubleQuoted[1]);
  const singleQuoted = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return singleQuoted ? decodeEntities(singleQuoted[1]) : null;
}

export function tablesIn(html: unknown): string[] {
  return [...String(html ?? '').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

export function rowsIn(table: string): string[] {
  return [...String(table ?? '').matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

export function cellsIn(row: string): string[] {
  return [...String(row ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
}

function jsonLdGraphs(html: unknown): JsonRecord[] {
  const items: JsonRecord[] = [];
  for (const match of String(html ?? '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const list = Array.isArray(data) ? data : Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
      for (const item of list) if (item && typeof item === 'object') items.push(item as JsonRecord);
    } catch {
      // Malformed JSON-LD on an otherwise healthy page is not a provider failure.
    }
  }
  return items;
}

/** "1.84 Billion" -> 1840000000, "$47.63" -> 47.63; null when unparseable. */
export function parseMoneyText(raw: unknown): number | null {
  const text = stripHtml(raw).replace(/[$,\s]/g, '');
  const match = /^([+-]?\d+(?:\.\d+)?)([KMBT])?/i.exec(text);
  if (!match) return null;
  const suffix = (match[2] ?? '').toUpperCase();
  const scale = suffix ? ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[suffix] : 1;
  const value = Number(match[1]) * (scale ?? 1);
  // Scaling must not leak binary-float noise into the published feed.
  return Number.isFinite(value) ? round(value, 2) : null;
}

export function parsePercentText(raw: unknown): number | null {
  const match = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(stripHtml(raw));
  return match ? Number(match[1]) : null;
}

/** "September 30, 2026" -> "2026-09-30"; null when the month is unknown. */
export function parseLongDate(raw: unknown): string | null {
  const match = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(stripHtml(raw));
  return match ? calendarIso(`${match[1]} ${match[2]}, ${match[3]}`) : null;
}

/** Number-ish feed text without currency/percent decoration; keeps placeholders. */
function numberText(raw: unknown): string {
  const value = numberOrNull(raw);
  return value === null ? cleanText(raw) : String(value);
}

// ---------------------------------------------------------------------------
// Catalog: sitemap discovery + the fund-page navigation list
// ---------------------------------------------------------------------------

export type CatalogFund = {
  ticker: string;
  name: string;
  fundPage: string;
  assetClass: string;
  isin: string;
  nav: number | null;
  navDate: string | null;
};

export function parseSitemapFundPages(xml: unknown): string[] {
  const urls = [...String(xml ?? '').matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => decodeEntities(match[1]).trim());
  const pages = urls
    .filter((url) => /^https:\/\/sprottetfs\.com\/[a-z0-9-]+-etf\/?$/i.test(url))
    .map((url) => (url.endsWith('/') ? url : `${url}/`));
  return [...new Set(pages)].sort();
}

export function tickerFromSlug(url: string): string {
  const slug = String(url).replace(/\/+$/, '').split('/').pop() ?? '';
  return sanitizeTicker(slug.split('-')[0] ?? '');
}

/** The site-wide fund list rendered on every fund page (`a.phv-btn` entries). */
export function parseCatalogNav(html: unknown): CatalogFund[] {
  const funds = new Map<string, CatalogFund>();
  for (const match of String(html ?? '').matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1);
    if (!/phv-btn/i.test(tag)) continue;
    const href = tagAttribute(tag, 'href');
    const title = tagAttribute(tag, 'title');
    const ticker = sanitizeTicker(stripHtml(match[1]));
    if (!href || !title || !/^[A-Z]{2,6}$/.test(ticker)) continue;
    if (!/^\/[a-z0-9-]+\/?$/i.test(href)) continue; // skip #anchors and external links
    const fundPage = `${SPROTT_SITE}${href.replace(/\/+$/, '')}/`;
    if (funds.has(ticker)) continue;
    funds.set(ticker, { ticker, name: cleanText(title), fundPage, assetClass: '', isin: '', nav: null, navDate: null });
  }
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

const CATEGORY_NAMES: Record<string, string> = {
  'critical-materials': 'Critical Materials',
  'sprott-precious-metals-etfs': 'Precious Metals',
};

/** The site's own breadcrumb (JSON-LD) is the only published fund grouping. */
export function parseCategory(html: unknown): string | null {
  for (const item of jsonLdGraphs(html)) {
    if (item['@type'] !== 'BreadcrumbList' || !Array.isArray(item.itemListElement)) continue;
    for (const element of item.itemListElement) {
      const slug = String(element?.item ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
      if (CATEGORY_NAMES[slug]) return CATEGORY_NAMES[slug];
    }
  }
  return null;
}

export function parseFundName(html: unknown): string | null {
  for (const item of jsonLdGraphs(html)) {
    if (item['@type'] !== 'InvestmentFund') continue;
    const name = cleanText(item.name);
    if (name) return name;
  }
  return null;
}

async function loadCatalog(config: UpdaterConfig): Promise<CatalogFund[]> {
  const sitemap = await fetchText(SITEMAP_URL, '[ catalog  ] sitemap', yahooHeaders(), config);
  const pages = parseSitemapFundPages(sitemap);
  if (!pages.length) throw new Error('Official sitemap lists no Sprott fund pages; keeping published index');
  let nav: CatalogFund[] = [];
  for (const page of pages.slice(0, 3)) {
    // One healthy fund page carries the complete fund list.
    try {
      nav = parseCatalogNav(await fetchText(page, `[ catalog  ] ${page.replace(SPROTT_SITE, '')}`, yahooHeaders(), config));
    } catch (error) {
      outputNote(`[ catalog  ] ${page}: ${errorMessage(error)}`);
    }
    if (nav.length >= pages.length) break;
  }
  if (!nav.length) {
    outputNote('[ catalog  ] fund navigation unavailable — using sitemap slugs and published identities');
    nav = pages.map((page) => ({ ticker: tickerFromSlug(page), name: '', fundPage: page, assetClass: '', isin: '', nav: null, navDate: null }));
  }
  const known = new Set(pages.map((page) => page.replace(/\/+$/, '')));
  const funds = nav.filter((fund) => known.has(fund.fundPage.replace(/\/+$/, '')) && /^[A-Z]{2,6}$/.test(fund.ticker));
  if (!funds.length) throw new Error('Fund navigation list empty; keeping published index');
  if (new Set(funds.map((fund) => fund.ticker)).size !== funds.length) throw new Error('Duplicate catalog ticker');
  return funds.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// Fund page sections
// ---------------------------------------------------------------------------

/** `<h3 class="color-gold">Label</h3> ... <h4>Value</h4>` pairs (pricing + key facts). */
export function parseLabelValues(html: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /<h3[^>]*class="[^"]*color-gold[^"]*"[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*class="[^"]*color-gold|<\/section>|$)/gi;
  for (const match of String(html ?? '').matchAll(pattern)) {
    const label = stripHtml(match[1]).replace(/\s+\d+$/, '').trim();
    const value = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(match[2]);
    if (!label || !value) continue;
    const text = stripHtml(value[1]);
    if (text && values[label] === undefined) values[label] = text;
  }
  return values;
}

/** "Fees & Expenses" table: Management Fee / Other Expenses / Total Annual ... */
export function parseFeesTable(html: unknown): Record<string, number | null> {
  const fees: Record<string, number | null> = {};
  const table = tablesIn(html).find((candidate) => /Management Fee/i.test(candidate) && /Total Annual Fund Operating Expenses/i.test(candidate));
  if (!table) return fees;
  for (const row of rowsIn(table)) {
    const cells = cellsIn(row);
    if (cells.length < 2) continue;
    fees[cells[0].replace(/\s+/g, ' ').trim()] = parsePercentText(cells[1]);
  }
  return fees;
}

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'SEDOL'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];

/** Quote-aware CSV for the page's embedded data-URI holdings download. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') continue;
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (quoted) {
        if (character === '"') {
          if (line[index + 1] === '"') { current += '"'; index++; } else quoted = false;
        } else current += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { cells.push(current); current = ''; }
      else current += character;
    }
    cells.push(current);
    rows.push(cells.map((cell) => cell.trim()));
  }
  return rows;
}

function holdingsRowFromCsv(headers: string[], cells: string[]): JsonRecord {
  const value = (...names: string[]): string => {
    for (const name of names) {
      const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
      if (index >= 0 && cells[index] !== undefined && cells[index] !== '') return cells[index];
    }
    return '';
  };
  return {
    Name: cleanText(value('Security', 'Name')),
    Ticker: cleanText(value('Symbol', 'Ticker')),
    Identifier: cleanText(value('SEDOL', 'CUSIP', 'ISIN')),
    Weight: numberText(value('Weight')),
    'Market Value': numberText(value('Market Value')),
    'Shares Held': numberText(value('Quantity', 'Shares Held')),
    SEDOL: cleanText(value('SEDOL')),
  };
}

/** The CSV and the rendered table are both read by their header text: a security name and a weight column are required. */
function missingHoldingsColumns(headers: string[]): string[] {
  const has = (...names: string[]): boolean => headers.some((header) => names.some((name) => header.toLowerCase() === name.toLowerCase()));
  return [has('Security', 'Name') ? '' : 'Security', has('Weight') ? '' : 'Weight'].filter(Boolean);
}

export function parseHoldingsSection(html: unknown): { rows: JsonRecord[]; asOfDate: string | null; source: string; headers: string[] } {
  const source = String(html ?? '');
  // Several sections carry an `update-date` paragraph; only the holdings one matters here.
  const holdingsStart = source.search(/<div\b[^>]*class="[^"]*holdings-table[^"]*"/i);
  const scope = holdingsStart >= 0 ? source.slice(holdingsStart) : source;
  const asOf = /<p[^>]*class="[^"]*update-date[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(scope);
  const asOfText = asOf ? stripHtml(asOf[1]).replace(/^As of\s*/i, '') : '';
  const asOfDate = asOfText ? isoDate(asOfText) ?? parseLongDate(asOfText) : null;
  const dataUri = /<a\b[^>]*href="data:application\/csv;charset=utf-8,([^"]*)"/i.exec(source);
  if (dataUri) {
    let decoded = dataUri[1];
    try { decoded = decodeURIComponent(decoded); } catch { /* keep the raw payload */ }
    const csv = parseCsv(decoded);
    if (csv.length > 1) {
      const [headers, ...body] = csv;
      const missing = missingHoldingsColumns(headers);
      if (missing.length) throw new Error(`Holdings CSV has no ${missing.join(' or ')} column (headers: ${headers.join(', ')})`);
      const rows = body.filter((cells) => cells.some((cell) => cell !== '')).map((cells) => holdingsRowFromCsv(headers, cells));
      if (rows.length) return { rows, asOfDate, source: 'sprottetfs.com "Download All Holdings" CSV', headers: HOLDINGS_HEADERS };
    }
  }
  const table = tablesIn(source).find((candidate) => /<th[^>]*>\s*Security\s*<\/th>/i.test(candidate));
  if (!table) throw new Error('Holdings table not found on the fund page');
  // Mapped by the header row, never by position: a reordered table must not put the market value into Weight or the SEDOL into Ticker.
  const [headers = [], ...body] = rowsIn(table).map(cellsIn);
  const missing = missingHoldingsColumns(headers);
  if (missing.length) throw new Error(`Holdings table has no ${missing.join(' or ')} column (headers: ${headers.join(', ')})`);
  const rows = body.filter((cells) => cells.length >= headers.length).map((cells) => holdingsRowFromCsv(headers, cells)).filter((row) => row.Name);
  if (!rows.length) throw new Error('Holdings table has no data rows');
  return { rows, asOfDate, source: 'sprottetfs.com fund page holdings table', headers: HOLDINGS_HEADERS };
}

export function parseDistributionsSection(html: unknown): { headers: string[]; payments: Array<{ epoch: number; amount: number }> } {
  const table = tablesIn(html).find((candidate) => /id="DistributionsData"/i.test(candidate));
  if (!table) return { headers: ['Ex-Date', 'Amount'], payments: [] };
  const rendered = rowsIn(table).map(cellsIn);
  const headers = rendered[0] ?? [];
  const exIndex = headers.findIndex((header) => /^ex-?\s*date$/i.test(header));
  const totalIndex = headers.findIndex((header) => /total distributions/i.test(header));
  const payments: Array<{ epoch: number; amount: number }> = [];
  for (const cells of rendered.slice(1)) {
    if (!cells.length) continue;
    const date = isoDate(cells[exIndex >= 0 ? exIndex : 0]);
    const amount = parseMoneyText(cells[totalIndex >= 0 ? totalIndex : cells.length - 1]);
    const epoch = date ? Date.parse(`${date}T00:00:00Z`) / 1000 : Number.NaN;
    if (!date || amount === null || !Number.isFinite(epoch)) continue;
    payments.push({ epoch, amount });
  }
  payments.sort((a, b) => a.epoch - b.epoch);
  return { headers: ['Ex-Date', 'Amount'], payments };
}

type ReturnValues = {
  ytd: number | null; yr1: number | null; yr3: number | null; yr5: number | null;
  yr10: number | null; sinceInception: number | null; mo1: number | null; qtd: number | null;
};
const EMPTY_RETURNS: ReturnValues = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, mo1: null, qtd: null };

const PERFORMANCE_COLUMNS: Array<[RegExp, keyof ReturnValues]> = [
  [/^1\s*MO/i, 'mo1'],
  [/^3\s*MO/i, 'qtd'],
  [/^YTD/i, 'ytd'],
  [/^1\s*YR/i, 'yr1'],
  [/^3\s*YR/i, 'yr3'],
  [/^5\s*YR/i, 'yr5'],
  [/^10\s*YR/i, 'yr10'],
  [/^S\.?\s*I\.?/i, 'sinceInception'],
];

export function parseReturnTable(table: string): ReturnValues {
  const values: ReturnValues = { ...EMPTY_RETURNS };
  const rendered = rowsIn(table).map(cellsIn);
  const header = rendered[0] ?? [];
  const slots = header.map((cell) => PERFORMANCE_COLUMNS.find(([pattern]) => pattern.test(cell))?.[1] ?? null);
  // The fund's own Net Asset Value row; benchmark/market-price rows are published elsewhere.
  const navRow = rendered.slice(1).find((cells) => cells.some((cell) => /\(net asset value\)/i.test(cell)));
  if (!navRow) return values;
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (!slot) continue;
    const raw = String(navRow[index] ?? '').trim();
    values[slot] = /^(--?|n\/?a|)$/i.test(raw) ? null : numberOrNull(raw);
  }
  return values;
}

/** Month-end and quarter-end "Average Annual Total Returns (%)" blocks. */
export function parseSprottPerformance(html: unknown): { month: JsonRecord | null; quarter: JsonRecord | null } {
  const source = String(html ?? '');
  const block = (heading: string, nextHeading: string | null): JsonRecord | null => {
    const start = source.indexOf(heading);
    if (start < 0) return null;
    const end = nextHeading ? source.indexOf(nextHeading, start) : -1;
    const slice = source.slice(start, end < 0 ? start + 30_000 : end);
    const table = tablesIn(slice).find((candidate) => /1\s*MO/i.test(candidate) && /S\.?\s*I\.?/i.test(candidate));
    if (!table) return null;
    const date = /As of\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(stripHtml(slice));
    const iso = date ? isoDate(date[1]) : null;
    if (!iso) return null;
    return { asOfDate: formatEdgarDate(iso), ...parseReturnTable(table) };
  };
  return { month: block('Month-End Performance', 'Quarter-End Performance'), quarter: block('Quarter-End Performance', null) };
}

/** CUSIPs are 9 characters without spaces ("85210B 201" -> "85210B201"). */
export function normalizeCusip(raw: unknown): string | null {
  const text = String(raw ?? '').replace(/^\s*CUSIP\s*:?/i, '').replace(/\s+/g, '').toUpperCase();
  return text || null;
}
export function parseFundPage(html: unknown, ticker: string): JsonRecord {
  const source = String(html ?? '');
  const labels = parseLabelValues(source);
  const fees = parseFeesTable(source);
  const asOf = /id="asOfDate"[^>]*>([\s\S]*?)<\/h2>/i.exec(source);
  const gross = fees['Total Annual Fund Operating Expenses'] ?? null;
  const net = parsePercentText(labels['Net Total Expense Ratio']) ?? gross;
  return {
    ticker: cleanText(labels.Ticker) || ticker,
    name: parseFundName(source),
    category: parseCategory(source),
    asOfDate: asOf ? parseLongDate(stripHtml(asOf[1])) : null,
    nav: parseMoneyText(labels.NAV),
    navDisplay: labels.NAV ?? null,
    marketPrice: parseMoneyText(labels['Market Price']),
    premiumDiscount: parsePercentText(labels['Premium/Discount']),
    aumValue: parseMoneyText(labels['Total Net Asset Value']),
    aumDisplay: labels['Total Net Asset Value'] ?? null,
    navDailyChange: parseMoneyText(labels['NAV Daily Change']),
    expenseRatio: { gross, net, value: net ?? gross },
    identifiers: {
      isin: (labels.ISIN ?? '').replace(/^ISIN\s*:?\s*/i, '') || null,
      cusip: normalizeCusip(labels.CUSIP),
      indexTicker: labels['Benchmark Index'] ?? null,
    },
    exchange: labels['Listing Exchange'] ?? null,
    inception: parseLongDate(labels['Inception Date'] ?? ''),
    indexRebalanceFrequency: labels['Index Rebalance Frequency'] ?? null,
    holdings: parseHoldingsSection(source),
    distributions: parseDistributionsSection(source),
    performance: parseSprottPerformance(source),
  };
}

function sortHoldings(rows: JsonRecord[]): JsonRecord[] {
  return rows.slice().sort((a, b) => (numberOrNull(b.Weight) ?? -Infinity) - (numberOrNull(a.Weight) ?? -Infinity) || String(a.Name).localeCompare(String(b.Name)));
}

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P fallback: the shared nport-reader block at the end of this file finds, reads and checks the filing
// ---------------------------------------------------------------------------

/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; reader: Map<string, unknown> } = { funds: null, names: null, reader: new Map() };

/** A fresh SEC state for a run (main and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[ edgar    ] ticker table', secHeaders(config), config).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company table', secHeaders(config), config).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/**
 * The Sprott holdings sheet of an N-PORT filing. Every row has exactly the published HOLDINGS_HEADERS keys, so header and
 * cell always agree (the old parser wrote an `Asset Category` key under a `SEDOL` header): SEDOL is the position's `other`
 * code when its otherDesc names a SEDOL, else '-'. A missing number stays empty (never 0), a missing text is '-'; tickers come
 * from nportTickers (U.S. equities only). Sorted by weight like the fund page sheet.
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: JsonRecord[] } {
  const rows = filing.positions.map((position, index) => {
    const cells: JsonRecord = {
      Name: position.name || '-',
      Ticker: tickers[index] || '-',
      Identifier: nportIdentifier(position) || '-',
      Weight: nportCell(position.weight),
      'Market Value': nportCell(position.value, 2),
      'Shares Held': nportCell(position.balance),
      SEDOL: position.other && /sedol/i.test(position.otherDesc) ? position.other : '-',
    };
    const row: JsonRecord = {};
    for (const header of HOLDINGS_HEADERS) row[header] = cells[header];
    return row;
  });
  return { headers: HOLDINGS_HEADERS, rows: sortHoldings(rows) };
}

/**
 * Holdings of the fund's newest own N-PORT-P filing (shared readNportHoldings: own series, registrant folder, strictly newer
 * than the published holdings `published` = meta.holdings), or null with the reason logged. SPROTT FUNDS TRUST files every
 * Sprott ETF: a fund missing from the SEC ticker table is looked up in the trust's filings by its exact name (a loose name
 * match is refused). A request failure that leaves no answer throws.
 */
async function readNportSheet(fund: CatalogFund, config: UpdaterConfig, published: JsonRecord | null | undefined): Promise<JsonRecord | null> {
  const ref = await loadFundTickerTable(config).then((table) => table.get(fund.ticker), (error: unknown) => {
    outputNote(`[ edgar    ] ticker table unavailable: ${errorMessage(error)}`);
    return undefined;
  });
  const publishedAsOf = storedDateIso(published?.asOfDate) ?? storedDateIso(published?.asOf);
  const read = await readNportHoldings(
    { ticker: fund.ticker, cik: ref ? ref.cik : SPROTT_TRUST_CIK, seriesId: ref ? ref.seriesId : null, name: fund.name },
    { asOf: publishedAsOf, rows: numberOrNull(published?.totalRows) ?? 0 },
    (url, label) => fetchText(url, `[ edgar    ] ${label}`, secHeaders(config), config),
    { cache: secState.reader, maxDocuments: ref ? undefined : 40 },
  );
  if ('problem' in read) {
    // an unparseable date on either side keeps the published sheet: say so even without VERBOSE
    if (/not newer/.test(read.problem) && (!publishedAsOf || /N-PORT undated/.test(read.problem))) console.warn(`[ edgar    ] ${read.problem}; a date cannot be parsed, kept the published holdings`);
    else outputNote(`[ edgar    ] ${read.problem}`);
    return null;
  }
  if (read.loose) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${read.candidate.accession} names series "${read.filing.seriesName}", only a partial match of "${fund.name}"; not used`);
    return null;
  }
  const names = await loadCompanyNames(config).catch(() => null);
  const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, names));
  return { rows: sheet.rows, headers: sheet.headers, asOfDate: read.filing.repPdDate || null, source: read.url, status: 'available' };
}

async function optional<T>(label:string, action:()=>Promise<T>):Promise<T|null> {
  try {return await action();} catch(e){outputNote(`[ fallback ] ${label}: ${errorMessage(e)}`);return null;}
}
const percent=(v:number|null|undefined)=>v==null?'—':`${v.toFixed(2)}%`;
const money=(v:number|null|undefined)=>v==null?'—':`$${v.toFixed(2)}`;
// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE=1e-4;
export function mergeHistory(previous:JsonRecord[], fresh:ChartDay[]):JsonRecord[] {
  const byDate=new Map<string,JsonRecord>();
  // "Oct 01 2026" is read as a calendar date, never through the machine's timezone (a run east of UTC wrote a second Oct 01 row).
  for (const row of previous) {
    const iso=storedDateIso(row.Date);
    if (iso) byDate.set(iso,row);
  }
  for (const day of fresh) {
    const [row]=historyRows([day]), published=byDate.get(day.date);
    const publishedAdj=published?numberOrNull(published['Adj Close']):null, raw=day.adjCloseRaw??day.adjClose;
    if (publishedAdj!==null && row['Adj Close']!==published!['Adj Close'] && Math.abs(raw-publishedAdj)<=0.005+ADJ_CLOSE_NOISE) row['Adj Close']=published!['Adj Close'];
    byDate.set(day.date,row);
  }
  return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
}
export function chartDaysFromRows(rows:JsonRecord[]):ChartDay[] {
  return rows.flatMap(row=>{
    const date=storedDateIso(row.Date), close=numberOrNull(row.Close), adjClose=numberOrNull(row['Adj Close']);
    return date&&close!==null&&adjClose!==null?[{date,close,adjClose,volume:numberOrNull(row.Volume)??0}]:[];
  });
}
function previousDividends(meta:JsonRecord):Array<{epoch:number;amount:number}> {
  return (meta.distributions?.rows??[]).flatMap((row:any[])=>{
    const date=isoDate(row[0]), amount=numberOrNull(row[1]);
    return date&&amount!==null?[{epoch:Date.parse(date)/1000,amount}]:[];
  });
}
function mergeDividends(old:JsonRecord,chart:ParsedChart|null):Array<{epoch:number;amount:number}> {
  const byDate=new Map(previousDividends(old).map(d=>[epochToIsoDate(d.epoch),d]));
  for (const d of chart?.dividends??[]) byDate.set(epochToIsoDate(d.epoch),d);
  return [...byDate.values()].sort((a,b)=>a.epoch-b.epoch);
}
/** ISO date from a stored "Sep 30 2026" / "Sep 30, 2026" / ISO / US date text, or null. */
export function storedDateIso(text: unknown): string | null {
  return isoDate(text);
}

/** Date the returns are as of: the official performance table date, else the last Yahoo close used. Never the NAV date. */
export function performanceAsOfDate(official: boolean, month: JsonRecord | null, derived: PriceReturns): string | null {
  const table = official ? storedDateIso(month?.asOfDate) : null;
  return table ?? (derived.asOfDate ? storedDateIso(derived.asOfDate) : null);
}

/** Month-end anchor as a UTC midnight: "Sep 30 2026" must not depend on the machine's timezone. */
export function monthAnchor(month: JsonRecord | null, days: ChartDay[]): Date | null {
  const iso = month?.asOfDate ? storedDateIso(month.asOfDate) : null;
  if (iso) return new Date(`${iso}T00:00:00Z`);
  return days.length ? new Date(`${days.at(-1)!.date}T00:00:00Z`) : null;
}
/** The shared young-fund rule (calendar anniversary, inclusive; an unknown date keeps the value) with Sprott's metric keys and table keys. */
const YOUNG_METRICS: Record<string, number> = { tr1y: 1, cagr3y: 3, tr3y: 3, cagr5y: 5, tr5y: 5, cagr10y: 10, tr10y: 10, siAnn: 1 };
const YOUNG_TABLE: Record<string, number> = { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 };
const RETURN_KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'returnsBasis', 'performanceAsOf'];
/** Previous return metrics as one unit (values + returnsBasis + performanceAsOf), or nothing when none were published. */
export function retainReturns(metrics: JsonRecord, previous: JsonRecord | null | undefined): JsonRecord {
  if (!previous || previous.performanceAsOf === undefined) return {};
  return Object.fromEntries(RETURN_KEYS.filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]]));
}
export type DividendYieldBasis = 'official-trailing-12m' | 'official-distribution-rate' | 'official-other' | 'computed-trailing-12m' | 'indicated';
/** Sprott publishes no yield of its own: every dividendYield is the updater's indicated estimate; no yield -> no code. */
export function dividendYieldBasis(divYield: number | null | undefined): DividendYieldBasis | null {
  return divYield === null || divYield === undefined || !Number.isFinite(divYield) ? null : 'indicated';
}
/** Rows kept from an older index get the code derived from their own yield, so every row has the same key set. */
export function withYieldBasis(row: JsonRecord): JsonRecord {
  const old = row.metrics ?? {};
  const metrics: JsonRecord = {};
  for (const [key, value] of Object.entries(old)) {
    if (key === 'dividendYieldBasis') continue;
    metrics[key] = value;
    if (key === 'dividendYieldText') metrics.dividendYieldBasis = dividendYieldBasis(numberOrNull(old.dividendYield));
  }
  if (!('dividendYieldBasis' in metrics)) metrics.dividendYieldBasis = dividendYieldBasis(numberOrNull(old.dividendYield));
  return { ...row, metrics };
}
export function buildMetrics(month:JsonRecord|null,derived:PriceReturns,secYield:number|null,divYield:number|null,returnsBasis:string,performanceAsOf:string|null):JsonRecord {
  const ytd=month?.ytd??derived.ytd, tr1y=month?.yr1??derived.yr1;
  const cagr3y=month?.yr3??derived.cagr3y,cagr5y=month?.yr5??derived.cagr5y,cagr10y=month?.yr10??derived.cagr10y;
  return {ytd,tr1y,cagr3y,cagr5y,cagr10y,tr3y:annualizedToTotal(cagr3y,3),tr5y:annualizedToTotal(cagr5y,5),tr10y:annualizedToTotal(cagr10y,10),
    siAnn:month?.sinceInception??derived.siAnn,secYield,secYieldText:percent(secYield),dividendYield:divYield,dividendYieldText:percent(divYield),dividendYieldBasis:dividendYieldBasis(divYield),returnsBasis,performanceAsOf};
}
function mergeSprottDividends(old: JsonRecord, page: JsonRecord | null, chart: ParsedChart | null): Array<{ epoch: number; amount: number }> {
  const byDate = new Map(previousDividends(old).map((dividend) => [epochToIsoDate(dividend.epoch), dividend]));
  for (const dividend of chart?.dividends ?? []) byDate.set(epochToIsoDate(dividend.epoch), dividend);
  // The official distribution table wins over the market-data feed for the same ex-date.
  for (const dividend of (page?.distributions?.payments ?? []) as Array<{ epoch: number; amount: number }>) {
    if (Number.isFinite(dividend.epoch) && Number.isFinite(dividend.amount)) byDate.set(epochToIsoDate(dividend.epoch), dividend);
  }
  return [...byDate.values()].sort((a, b) => a.epoch - b.epoch);
}

/** Why a published fund is kept whole: one of its required sources did not answer. */
export function requiredSourceFailed(source: string): string {
  return `required source failed: ${source}; kept the previous complete data`;
}

async function processFund(fund: CatalogFund, config: UpdaterConfig, previousIndex: JsonRecord): Promise<JsonRecord | null> {
  const ticker = fund.ticker, dir = new URL(`funds/${ticker}/`, API_ROOT);
  const old = await readJson(new URL('meta.json', dir)) ?? {};
  let page: JsonRecord | null = null;
  if (!config.skipSprott) {
    page = await optional(`${ticker} fund page`, async () => {
      const raw = await fetchText(fund.fundPage, `[ product  ] ${ticker}`, yahooHeaders(), config);
      const parsed = parseFundPage(raw, ticker);
      if (parsed.ticker !== ticker) throw new Error(`page reports ticker ${parsed.ticker}`);
      await storeRaw(ticker, 'fund-page', { ...parsed, holdings: { ...parsed.holdings, rows: [] } }, config);
      return parsed;
    });
  }
  // Evaluate known, fresh headline filters before holdings/history downloads.
  const aum = page?.aumValue ?? old.aum?.value ?? previousIndex.aumValue ?? null;
  const ter = page?.expenseRatio?.value ?? old.expenseRatio?.value ?? previousIndex.terValue ?? null;
  if (!inRange(aum, config.aumRange) || !inRange(ter, config.terRange)) return null;
  const secYield = old.yields?.secYield ?? null; // Sprott publishes no 30-day SEC yield on its fund pages.
  if (!inRange(secYield, config.secYieldRange)) return null;
  // The fund page and Yahoo are required sources: when one of them failed, a published fund stays exactly as it was
  // (never fresh Yahoo prices, history and yields next to the previous NAV, AUM, TER and official returns).
  const published = Object.keys(old).length > 0;
  if (published && !config.skipSprott && !page) throw new Error(requiredSourceFailed('fund page'));

  let holdings: JsonRecord | null = null;
  const pageRows: JsonRecord[] = page?.holdings?.rows ?? [];
  if (pageRows.length) {
    holdings = { rows: sortHoldings(pageRows), headers: HOLDINGS_HEADERS, asOfDate: page?.holdings?.asOfDate ?? null, source: page?.holdings?.source ?? 'sprottetfs.com fund page', status: 'available' };
  }
  // An N-PORT filing is weeks old; it replaces published holdings only when strictly newer (they are kept below otherwise).
  if (!holdings && config.edgarFallback) holdings = await optional(`${ticker} SEC holdings`, () => readNportSheet(fund, config, old.holdings));
  const holdingsFresh = holdings !== null; // false when the previous run's sheet is re-read below
  if (!holdings) {
    const rows = await readPreviousSheet(ticker, 'holdings'), headers = await readPreviousSheetHeaders(ticker, 'holdings');
    if (old.holdings?.totalRows && rows.length !== old.holdings.totalRows) throw new Error(`${ticker}: previous holdings incomplete; refusing overwrite`);
    holdings = { rows, headers: headers.length ? headers : HOLDINGS_HEADERS, asOfDate: old.holdings?.asOfDate ?? null,
      source: old.holdings?.source ?? 'unavailable from official/SEC sources',
      status: old.holdings?.status ?? (rows.length ? 'available' : 'unavailable') };
  }
  const chart = config.skipYahoo ? null : await optional(`${ticker} Yahoo`, async () => {
    const raw = await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config);
    await storeRaw(ticker, 'yahoo', raw, config);
    const fetched = parseChart(raw);
    // A HISTORY_RANGE window never shrinks the published history: older published days are rescaled onto the window by the
    // overlapping days (shared windowed-chart block); a window that does not join keeps the fund as published
    if (!/^\d+y$/i.test(config.historyRange)) return fetched;
    const merged = mergeWindowedChart(fetched, await readPreviousSheet(ticker, 'history'), Array.isArray(old.distributions?.rows) ? old.distributions.rows : []);
    if (!merged) throw new Error(`chart window does not join the published history (${config.historyRange})`);
    return merged;
  });
  if (published && !config.skipYahoo && !chart) throw new Error(requiredSourceFailed('Yahoo chart'));
  const oldHistory = await readPreviousSheet(ticker, 'history');
  if (old.history?.totalRows && oldHistory.length !== old.history.totalRows) throw new Error(`${ticker}: previous history incomplete; refusing overwrite`);
  const history = chart?.days.length ? mergeHistory(oldHistory, chart.days) : oldHistory;
  const days = chartDaysFromRows(history);
  const dividends = mergeSprottDividends(old, page, chart), latest = dividends.at(-1) ?? null;
  const frequency = dividends.length
    ? inferDistributionFrequency(dividends)
    : old.distributions?.frequency && old.distributions.frequency !== '—'
      ? { frequency: String(old.distributions.frequency), paymentsPerYear: numberOrNull(old.distributions.paymentsPerYear) }
      : { frequency: '—', paymentsPerYear: null };
  const nav = page?.nav ?? old.nav?.value ?? fund.nav ?? null;
  const navDate = page?.asOfDate ?? null;
  const price = page?.marketPrice ?? chart?.regularMarketPrice ?? old.marketPrice?.value ?? null;
  const priceDate = page?.asOfDate ?? (chart?.regularMarketTime ? epochToIsoDate(chart.regularMarketTime) : null);
  // Do not compute a premium from prices belonging to different days.
  const premium = page?.premiumDiscount ?? (nav !== null && nav > 0 && price !== null && navDate && priceDate && navDate === priceDate
    ? round((price / nav - 1) * 100, 2)
    : old.premiumDiscount?.value ?? null);
  // Retain the old yield only when no source answered at all; an honest null (unknown frequency) stays null.
  const divYield = indicatedYield(latest?.amount ?? null, frequency.paymentsPerYear, price) ?? (page || chart ? null : old.yields?.dividendYield ?? null);
  let month: JsonRecord | null = page?.performance?.month ?? old.returns?.monthEnd ?? null;
  let quarter: JsonRecord | null = page?.performance?.quarter ?? old.returns?.quarterEnd ?? null;
  const anchor = monthAnchor(month, days);
  const usable = anchor ? days.filter((day) => Date.parse(day.date) <= anchor.getTime()) : [];
  const derived = usable.length ? priceReturns(usable, anchor!) : { ...EMPTY_PRICE_RETURNS };
  // A range-limited Yahoo download is not a since-inception return.
  if (!chart?.firstTradeDate || !days.length || Date.parse(days[0].date) / 1000 - chart.firstTradeDate > 7 * 86400) derived.siAnn = null;
  const hasOfficialReturns = Boolean(page?.performance?.month) || Boolean(month && !String(old.returns?.derivedFrom ?? '').startsWith('Yahoo adjusted'));
  const returnsBasis = hasOfficialReturns
    ? 'official sprottetfs.com month-end/quarter-end average annual total returns (NAV); missing metrics derived from Yahoo adjusted closes at the same reporting date'
    : 'Yahoo adjusted market-price returns, not official NAV';
  // the shared "younger than one year" rule: no horizon the fund is too young for, official or derived
  const inception = page?.inception ?? old.inception?.fundInceptionDate ?? null;
  const metrics = buildMetrics(month, derived, secYield, divYield, returnsBasis, performanceAsOfDate(hasOfficialReturns, month, derived));
  Object.assign(metrics, withoutYoungReturns(metrics, inception, metrics.performanceAsOf, YOUNG_METRICS));
  if (month) month = { ...month, ytd: month.ytd ?? derived.ytd, mo1: month.mo1 ?? derived.mo1, qtd: month.qtd ?? derived.qtd };
  else if (usable.length) month = { asOfDate: formatEdgarDate(derived.asOfDate!), mo1: derived.mo1, qtd: derived.qtd, ytd: derived.ytd, yr1: derived.yr1, yr3: derived.cagr3y, yr5: derived.cagr5y, yr10: derived.cagr10y, sinceInception: derived.siAnn };
  if (month) month = withoutYoungReturns(month, inception, month.asOfDate, YOUNG_TABLE);
  if (quarter) quarter = withoutYoungReturns(quarter, inception, quarter.asOfDate, YOUNG_TABLE);
  const filtered = fundFilterReasons({ ticker, aumValue: aum, terValue: ter, metrics }, config);
  if (filtered.length) return null;
  // Returns come from the official table or Yahoo closes; if neither answered, keep the previous
  // returns together with the date and basis they describe (never old values under a new date).
  if (!page?.performance?.month && !chart?.days.length) {
    Object.assign(metrics, retainReturns(metrics, previousIndex.metrics));
    Object.assign(metrics, withoutYoungReturns(metrics, inception, metrics.performanceAsOf, YOUNG_METRICS));
  }
  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone) never
  // replace the published ones: the fund fails before anything is written, so it stays exactly as published.
  // No relax lets an all-dash weight sheet replace a published sheet with numeric weights (5th argument, open-items etfs Q24).
  const publishedHeaders = await readPreviousSheetHeaders(ticker, 'holdings');
  const publishedWeights = holdingsFresh && published ? holdingsWeightCount(publishedHeaders.length ? publishedHeaders : HOLDINGS_HEADERS, await readPreviousSheet(ticker, 'holdings')) : null;
  const holdingsProblem = holdingsFresh ? holdingsGuard(holdings.headers, holdings.rows, numberOrNull(old.holdings?.totalRows), HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights) : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${Object.keys(old).length ? 'kept the previous complete data' : 'no data published for this fund yet'}`);
  if (!page && !chart && !Object.keys(old).length) throw new Error(`${ticker}: no usable per-fund source`);
  // A new fund is published only with holdings: Yahoo alone would give it an empty sheet reported as updated.
  if (!published && !holdingsFresh) throw new Error(`${ticker}: no holdings source answered; no data published for this fund yet`);
  const name = cleanText(page?.name) || fund.name || cleanText(old.name) || ticker;
  const category = cleanText(page?.category) || cleanText(old.category) || 'ETF';
  const exchange = cleanText(page?.exchange) || cleanText(old.inception?.exchange) || chart?.exchangeName || '';
  const holdingsManifest = await writePages(dir, ticker, 'holdings', holdings.headers, holdings.rows, config.holdingsPageSize);
  const oldHistoryHeaders = await readPreviousSheetHeaders(ticker, 'history');
  const historyManifest = await writePages(dir, ticker, 'history', chart?.days.length ? ['Date', 'Close', 'Adj Close', 'Volume'] : oldHistoryHeaders.length ? oldHistoryHeaders : ['Date', 'Close', 'Adj Close', 'Volume'], history, config.historyPageSize);
  const historySource = chart?.days.length ? 'Yahoo Finance daily market-price closes / adjusted closes (not official NAV)' : old.history?.source ?? 'unavailable';
  const meta = {
    ticker, name, category, categoryPath: cleanText(old.categoryPath) || category,
    source: { fundPage: fund.fundPage, catalog: CATALOG_PAGE, holdingsDownload: fund.fundPage, holdingsSource: holdings.source, historySource, yahooChart: `${YAHOO_CHART_URL}/${ticker}`, provider: 'sprottetfs.com official fund pages; SEC EDGAR N-PORT-P holdings fallback; Yahoo Finance market-history/dividend fallback' },
    providerIds: { fundPage: fund.fundPage },
    legalStructure: old.legalStructure ?? null,
    identifiers: { cusip: normalizeCusip(page?.identifiers?.cusip ?? old.identifiers?.cusip), isin: page?.identifiers?.isin ?? old.identifiers?.isin ?? fund.isin ?? null, indexTicker: page?.identifiers?.indexTicker ?? old.identifiers?.indexTicker ?? null },
    inception: { fundInceptionDate: page?.inception ?? old.inception?.fundInceptionDate ?? null, shareClassInceptionDate: old.inception?.shareClassInceptionDate ?? null, exchange },
    expenseRatio: { display: percent(ter), value: ter, gross: page?.expenseRatio?.gross ?? old.expenseRatio?.gross ?? null, net: page?.expenseRatio?.net ?? old.expenseRatio?.net ?? null },
    nav: { display: money(nav), value: nav, asOfDate: navDate ? formatEdgarDate(navDate) : old.nav?.asOfDate ?? '—' },
    marketPrice: { display: money(price), value: price, asOfDate: priceDate ? formatEdgarDate(priceDate) : old.marketPrice?.asOfDate ?? '—' },
    premiumDiscount: { display: percent(premium), value: premium },
    aum: { display: aum === null ? '—' : page?.aumDisplay ?? formatAumDisplay(aum), value: aum, asOfDate: navDate ? formatEdgarDate(navDate) : old.aum?.asOfDate ?? '—', source: page?.aumDisplay ? 'sprottetfs.com fund page (Total Net Asset Value)' : old.aum?.source ?? 'unavailable' },
    yields: { dividendYield: metrics.dividendYield, dividendYieldText: metrics.dividendYieldText, dividendYieldKind: 'indicated (latest distribution x payments per year / market price)',
      secYield: metrics.secYield, secYieldText: metrics.secYieldText, secYieldKind: old.yields?.secYieldKind ?? 'not published', unsubsidizedSecYield: old.yields?.unsubsidizedSecYield ?? null },
    returns: { monthEnd: month, quarterEnd: quarter, derivedFrom: returnsBasis },
    distributions: { frequency: frequency.frequency, paymentsPerYear: frequency.paymentsPerYear, headers: ['Ex-Date', 'Amount'], rows: distributionRows(dividends) },
    holdings: { ...holdingsManifest, asOfDate: holdings.asOfDate, asOf: holdings.asOfDate ? formatEdgarDate(holdings.asOfDate) : '—', source: holdings.source, status: holdings.status },
    history: { ...historyManifest, asOf: days.length ? formatEdgarDate(days.at(-1)!.date) : old.history?.asOf ?? '—', source: historySource },
  };
  await writeIfChanged(new URL('meta.json', dir), meta);
  // Stale pages go only after the new meta (which lists the new pages) is on disk.
  await removeStalePages(dir, 'holdings', new Set(holdingsManifest.pages));
  await removeStalePages(dir, 'history', new Set(historyManifest.pages));
  return { ticker, name, category, fundPage: fund.fundPage, dataFile: `./funds/${ticker}/meta.json`,
    cusip: meta.identifiers.cusip, isin: meta.identifiers.isin, ter: meta.expenseRatio.display, terValue: ter, nav: meta.nav.display, navValue: nav, aum: meta.aum.display, aumValue: aum,
    asOfDate: meta.nav.asOfDate, inceptionDate: meta.inception.fundInceptionDate ? formatEdgarDate(meta.inception.fundInceptionDate) : '—',
    exchange, closePrice: meta.marketPrice.display, closePriceValue: price, premiumDiscount: meta.premiumDiscount.display, premiumDiscountValue: premium,
    distributions: { frequency: frequency.frequency, exDate: latest ? formatUsDate(latest.epoch) : '—', dividend: latest ? String(round(latest.amount, 6)) : '—' },
    returns: meta.returns, metrics, holdings: holdings.rows.length, history: history.length };
}
/** Index row of a catalog fund with no published meta.json (new, or its first refresh failed or the guard rejected it): catalog headlines only, dataFile null, every metric unknown (null). */
export function catalogOnlyRow(fund: CatalogFund): JsonRecord {
  const metrics = buildMetrics(null, { ...EMPTY_PRICE_RETURNS }, null, null, 'no returns published for this fund yet', null);
  return { ticker: fund.ticker, name: fund.name || fund.ticker, category: fund.assetClass || 'ETF', fundPage: fund.fundPage, dataFile: null,
    cusip: null, isin: fund.isin || null, ter: '—', terValue: null, nav: money(fund.nav), navValue: fund.nav, aum: '—', aumValue: null,
    asOfDate: fund.navDate ? formatEdgarDate(fund.navDate) : '—', inceptionDate: '—', exchange: '', closePrice: '—', closePriceValue: null,
    premiumDiscount: '—', premiumDiscountValue: null, distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: { monthEnd: null, quarterEnd: null, derivedFrom: null }, metrics, holdings: 0, history: 0 };
}
export function batchSelection(funds:CatalogFund[],config:UpdaterConfig,cursor:string|null):CatalogFund[] {
  // A closed fund leaves the queue after the TICKERS filter and before the MAX_FETCHES budget: never fetched, guarded or reported.
  const selected=withoutClosedFunds(funds.filter(f=>!config.tickers.length||config.tickers.includes(f.ticker)),f=>f.ticker,CLOSED_FUNDS);
  if (!config.maxFetches) return selected;
  // Resume after the cursor even when the cursor fund is outside the selection: next selected ticker, then wrap.
  const i=cursor===null?0:selected.filter(f=>f.ticker.localeCompare(cursor)<=0).length;
  return selected.slice(i).concat(selected.slice(0,i)).slice(0,config.maxFetches);
}
// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides. Allowlisted scalar values only: the
// same resolver is used by Actions without interpolating user input into bash.
// Legacy env names that keep working next to SPROTT_<NAME> and <NAME>.
const ENV_ALIASES: Record<string, string[]> = {
  MAX_FETCHES: ['SPROTT_LIMIT'],
  HISTORY_PAGE_SIZE: ['HISTORICAL_PAGE_SIZE'],
  STORE_RAW_DOWNLOADS: ['SPROTT_STORE_RAW_DOWNLOADS'],
};
export const CONTROL_NAMES = [
  'MAX_FETCHES','REQUEST_SLEEP','CONCURRENCY','AUM','TER','DIVIDEND_YIELD','SEC_YIELD','TICKERS',
  'HOLDINGS_PAGE_SIZE','HISTORY_PAGE_SIZE','MAX_RETRIES','HISTORY_RANGE','STORE_RAW_DOWNLOADS',
  'SEC_UA','SKIP_YAHOO','SKIP_SPROTT','EDGAR_FALLBACK','VERBOSE','USE_SYSTEM_CA',
  ...['PERFORMANCE','TOTAL_RETURN'].flatMap(prefix=>['YTD','1Y','3Y','5Y','10Y'].map(period=>`${prefix}_${period}`)),
] as const;
export function resolveControls(file:unknown={},advanced:unknown={},inputs:unknown={},env:Record<string,string|undefined>={}):Record<string,string> {
  const result:Record<string,string>={};
  const known=new Set<string>(CONTROL_NAMES);
  const apply=(value:unknown,skipEmpty=false)=>{
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key,raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw===''||raw===undefined||raw===null)) continue;
      if (!['string','number','boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text=String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key]=text;
    }
  };
  apply(file);apply(advanced);apply(inputs,true);
  for(const key of CONTROL_NAMES){
    const value=[`SPROTT_${key}`,key,...(ENV_ALIASES[key]??[])].map(name=>env[name]).find(v=>v!==undefined);
    if(value!==undefined)apply({[key]:value});
  }
  for(const key of ['MAX_FETCHES','CONCURRENCY','HOLDINGS_PAGE_SIZE','HISTORY_PAGE_SIZE','MAX_RETRIES']){
    const v=result[key];if(v===undefined)continue;
    const min=key==='MAX_FETCHES'?0:1;
    if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<min)throw new Error(`${key}: expected integer >= ${min}`);
  }
  if(result.REQUEST_SLEEP!==undefined && (result.REQUEST_SLEEP.trim()===''||!Number.isFinite(Number(result.REQUEST_SLEEP))||Number(result.REQUEST_SLEEP)<0))throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  if(result.HISTORY_RANGE && !/^(max|[1-9]\d*y)$/i.test(result.HISTORY_RANGE))throw new Error('HISTORY_RANGE: use max or Ny');
  for(const key of ['STORE_RAW_DOWNLOADS','SKIP_YAHOO','SKIP_SPROTT','EDGAR_FALLBACK','VERBOSE']){
    if(result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key]))throw new Error(`${key}: expected boolean`);
  }
  if(result.USE_SYSTEM_CA!==undefined){
    const mode=result.USE_SYSTEM_CA.toLowerCase();
    if(!['auto','true','false'].includes(mode))throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA=mode;
  }
  readConfig(result); // validate all min:max filters before a request or write
  return result;
}
// Bounded worker pool: `size` workers pull items in order until the queue is empty.
export async function runPool<T>(items:readonly T[],size:number,run:(item:T,index:number)=>Promise<void>):Promise<void> {
  let next=0;
  const worker=async()=>{for(;;){const i=next++;if(i>=items.length)return;await run(items[i],i);}};
  await Promise.all(Array.from({length:Math.max(1,Math.min(size,items.length))},worker));
}
export async function runtimeControls(env:Record<string,string|undefined>=process.env):Promise<Record<string,string>> {
  let file:unknown={};
  try {file=JSON.parse(await readFile(new URL('./update-data.config.json',import.meta.url),'utf8'));}
  catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  return resolveControls(file,{}, {},env);
}

export async function main(env:Record<string,string|undefined>=process.env):Promise<void> {
  const startedAt=Date.now();
  const controls=await runtimeControls(env);
  if(controls.VERBOSE!==undefined)process.env.VERBOSE=controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA??'auto');
  const config=readConfig(controls); configureRequestPacing(config.concurrency,config.requestSleep*1000);
  resetSecState();
  outputPrintConfig('Sprott',config);
  const previous=await readJson(INDEX_FILE), oldFunds=new Map<string,JsonRecord>((previous?.funds??[]).map((f:JsonRecord)=>[f.ticker,f]));
  let catalog:CatalogFund[]|null=null;
  if (!config.skipSprott) catalog=await optional('catalog',()=>loadCatalog(config));
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists is dropped, never retried.
  const live=catalog?catalog.map(f=>f.ticker):null, previousRows=Array.from(oldFunds.values());
  if (!catalog) {
    console.warn('[ catalog  ] official source unavailable/skipped — using published provider identities');
    catalog=[];
    for (const [ticker,row] of oldFunds) {
      const meta=await readJson(new URL(`funds/${ticker}/meta.json`,API_ROOT));
      catalog.push({ticker,name:cleanText(meta?.name)||cleanText(row.name)||ticker,
        fundPage:cleanText(meta?.source?.fundPage)||cleanText(row.fundPage)||`${SPROTT_SITE}/`,
        assetClass:cleanText(meta?.category)||cleanText(row.category)||'ETF',
        isin:cleanText(meta?.identifiers?.isin)||cleanText(row.isin),nav:numberOrNull(row.navValue),
        navDate:isoDate(meta?.nav?.asOfDate)||isoDate(row.asOfDate)});
    }
  }
  catalog.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers.length?config.tickers:null,knownTickers(live,previousRows),'the Sprott catalog or published feed');
  if (!catalog.length) throw new Error('No official or previously published catalog; refusing empty success');
  console.log(`[ catalog  ] ${catalog.length} Sprott ETFs (sprottetfs.com fund navigation / published fallback)`);
  const state=await readJson(STATE_FILE), queue=batchSelection(catalog,config,state?.cursor??null);
  outputPrintFilter(queue.length,catalog.length,outputHasOutputFilters(config));
  // Filtered, bounded, skipped and failed funds keep their published row; a stale catalog-only row (no data, not listed) is dropped
  const reporter=outputCreateReporter(API_ROOT,queue.length), result=new Map<string,JsonRecord>(withoutStalePlaceholders(previousRows,live).map(row=>[String(row.ticker),row] as [string,JsonRecord]));
  let failures=0,processed=0,skipped=0,deferred=0;
  const deadline=Date.now()+SOFT_DEADLINE_MS;
  await runPool(queue,config.concurrency,async(fund)=>{
    if(Date.now()>deadline){deferred++;return;} // stop taking new funds; the index is still written
    const before=await reporter.before(fund.ticker);
    try {
      // A catalog-only row (dataFile null) is not published data: never read it as the fund's previous state.
      const published=oldFunds.get(fund.ticker);
      const row=await processFund(fund,config,published&&published.dataFile?published:{});
      if(row){result.set(fund.ticker,row);processed++;}
      else skipped++;
      await reporter.result(fund.ticker,before,row?undefined:'skipped');
    } catch(e) {failures++;await reporter.result(fund.ticker,before,'failed',errorMessage(e));}
  });
  if (!result.size) throw new Error('No publishable funds; not replacing the index');
  // A catalog fund with nothing published (new, or its first refresh failed or the guard rejected it) is still listed: no meta.json, so dataFile is null.
  for (const fund of catalog) if (!result.has(fund.ticker) && !await readJson(new URL(`funds/${fund.ticker}/meta.json`,API_ROOT))) result.set(fund.ticker,catalogOnlyRow(fund));
  const funds=markClosedFunds([...result.values()].map(withYieldBasis).sort((a,b)=>a.ticker.localeCompare(b.ticker)),CLOSED_FUNDS);
  const counts={funds:funds.length,holdings:funds.reduce((s,f)=>s+f.holdings,0),history:funds.reduce((s,f)=>s+f.history,0)};
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds=newFundsLines(newFundsReport(previousRows,funds));
  for (const line of newFunds) console.log(line);
  if(newFunds.length&&env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`### NEW FUNDS\n\n${newFunds.join('\n')}\n\n`);
  const indexBody={source:{provider:'Sprott ETFs',site:SPROTT_SITE,catalog:CATALOG_PAGE},counts,funds};
  if(!samePublishedContent(JSON.stringify(withoutStamps(previous)),indexBody)){
    const stamp=isoSeconds();
    await writeIfChanged(INDEX_FILE,{generatedAt:stamp,catalogReadAt:stamp,...indexBody});
  }
  // Cursor follows deterministic queue order, not asynchronous completion order.
  // Failed batches leave the cursor in place so the next run retries them.
  if (config.maxFetches && !failures && !deferred && queue.length) await writeIfChanged(STATE_FILE,{cursor:queue.at(-1)!.ticker});
  else if (!config.maxFetches && !failures && !deferred && !config.tickers.length) await rm(STATE_FILE,{force:true});
  if(deferred)console.warn(`[ deadline ] ${deferred} funds deferred (soft deadline); they keep their published data`);
  console.log(reporter.summary(startedAt));
  console.log(outputCounts(counts.funds,counts.holdings,counts.history));
  if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`### Sprott update\n\n${processed} processed; ${skipped} skipped; ${failures} failed.\n${counts.funds} funds / ${counts.holdings} holdings / ${counts.history} history rows.\n`);
  if(failures)process.exitCode=1;
}
export const USAGE=`Sprott ETF static-feed updater (zero runtime dependencies; Bun only).

Usage: bun ./scripts/update-data.ts [--help]

Environment controls:
  TICKERS              Space/comma/semicolon separated ETF tickers. ANDed with other filters.
  MAX_FETCHES          0 means all selected funds; positive values resume at the saved cursor.
  REQUEST_SLEEP        Seconds between request starts on each worker lane, including retries (default 1).
  CONCURRENCY          Parallel fund workers, each with its own request lane (default 2); throughput is about CONCURRENCY / REQUEST_SLEEP requests per second.
  MAX_RETRIES          Retries after the first request, integer >= 1 (default 2).
  HOLDINGS_PAGE_SIZE   Holdings rows per static JSON page (default 250).
  HISTORY_PAGE_SIZE    History rows per static JSON page (default 1000).
  HISTORY_RANGE        Yahoo daily history range: max or Ny (default max).
  AUM                  Dollar min:max; K/M/B/T suffixes or nano/micro/small/mid/large presets.
  TER                  Net expense-ratio percent min:max.
  DIVIDEND_YIELD       Indicated dividend yield percent min:max.
  SEC_YIELD            30-day SEC yield percent min:max (Sprott publishes none).
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y   Annualized return percent min:max.
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y  Cumulative total-return percent min:max.
  STORE_RAW_DOWNLOADS  Keep raw provider JSON snapshots beside the feed (default false).
  SEC_UA               Contact-bearing User-Agent for SEC EDGAR (default "daggerok ETF feed daggerok@gmail.com"; redacted in logs).
  EDGAR_FALLBACK       Enable Form N-PORT-P holdings fallback (default true).
  SKIP_SPROTT          Do not request sprottetfs.com (keeps published data).
  SKIP_YAHOO           Disable Yahoo history and dividends.
  VERBOSE              Show per-request retries and fallback notices.
  USE_SYSTEM_CA        TLS trust store: auto (default) restarts once with Bun's --use-system-ca on an untrusted-certificate error, true always uses the system CA store, false never restarts.

Defaults: scripts/update-data.config.json; an explicitly set environment variable overrides the file (SPROTT_<KEY> wins over <KEY>).
Actions: file < advanced JSON < nonblank inputs < protected variables. Range syntax is strict min:max; an empty side is unbounded.

Examples:
  TICKERS="URNM URNJ SETM" bun ./scripts/update-data.ts
  MAX_FETCHES=3 bun ./scripts/update-data.ts
  AUM="100M:" TER=":0.7" bun ./scripts/update-data.ts
`;
if(import.meta.main){
  if(process.argv.some(a=>a==='--help'||a==='-h')){
    console.log(USAGE);
    outputPrintConfig('Sprott effective configuration',readConfig(await runtimeControls(process.env)));
  }else await main().catch(e=>{console.error(`[ done     ] ${errorMessage(e)}`);process.exitCode=1;});
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for an equity row (assetCat EC or EP) traded in USD with a U.S. ISIN or none, and never one ticker on two
 *   different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/** A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped). */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const text = value.toFixed(digits);
  return text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/** A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*\/\s*[A-Za-z]{2,3}\s*\/?)+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ');
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/** SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too). */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
  }
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to an equity row (assetCat EC or
 * EP) traded in USD (or with no currency) whose ISIN is U.S. or missing: first the filer's own `<ticker value>`, else the
 * SEC issuer-name table (`names`) when the row has a CUSIP or a U.S. ISIN. A ticker that lands on two different securities
 * (Alphabet A and C, an ordinary share and its ADR) is dropped from the name-matched rows; when the filer itself gave it
 * to two securities it is dropped from all of them. Bonds, cash, funds and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = (position.assetCat === 'EC' || position.assetCat === 'EP') && !position.derivative;
    const usd = !position.currency || position.currency === 'USD';
    if (!equity || !usd || (position.isin && position.isin.slice(0, 2) !== 'US')) return '';
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker)) {
      fromFiler[index] = true;
      return position.ticker;
    }
    if (!names || !(/^[0-9A-Z]{9}$/.test(position.cusip) || /^US[0-9A-Z]{10}$/.test(position.isin))) return '';
    const key = nportNameKey(position.name);
    return names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  return tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
