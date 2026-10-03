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
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
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
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|^SEC_UA$/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
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
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}

import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';

type JsonRecord = Record<string, any>;
const SPROTT_SITE = 'https://sprottetfs.com';
const SITEMAP_URL = `${SPROTT_SITE}/sitemap.xml`;
const CATALOG_PAGE = SITEMAP_URL;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const EDGAR_BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar';
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

// "08/21/2026" / "2026-08-21T00:00:00Z" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
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

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

export function yahooSearchUrl(name: string): string {
  return `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
}

// Strict matcher for Yahoo search payloads: the quote's long name must
// normalize to the same name (or token-core) as the filed holding name. Only
// EQUITY/ETF quotes are accepted, and single/two-word holdings may additionally
// match by token containment (e.g. "BULLISH" -> "Bullish BLCM Inc").
export function pickSearchTicker(name: string, payload: JsonRecord): string | null {
  const matches: unknown[] = Array.isArray(payload?.quoteMatches) ? payload.quoteMatches : [];
  const norm = normalizeHoldingName(name);
  if (!norm) return null;
  const core = norm.replace(/ /g, '');
  const tokens = norm.split(' ');
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const record = match as JsonRecord;
    const quoteType = String(record.quoteType || '').toUpperCase();
    if (quoteType !== 'EQUITY' && quoteType !== 'ETF') continue;
    const symbol = cleanHoldingTicker(record.symbol);
    if (!symbol) continue;
    const longName = String(record.longname || record.shortname || '');
    const candidate = normalizeHoldingName(longName);
    if (!candidate) continue;
    if (candidate === norm || candidate.replace(/ /g, '') === core) return symbol;
    if (tokens.length <= 2 && tokens.every((token) => candidate.includes(token))) return symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds whose fund page does
// not carry a downloadable holdings sheet, resolved through EDGAR.
// ---------------------------------------------------------------------------

export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

export function nportUrlFor(cik: string, accession: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

export function parseNportAccessions(submissions: JsonRecord): NportAccession[] {
  const recent = submissions?.filings?.recent;
  const result: NportAccession[] = [];
  if (!recent || !Array.isArray(recent.form)) return result;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== 'NPORT-P') continue;
    const accession: string = String(recent.accessionNumber?.[i] || '');
    if (!accession) continue;
    result.push({
      accession,
      filed: String(recent.filingDate?.[i] || ''),
      reportDate: String(recent.reportDate?.[i] || ''),
      url: nportUrlFor(String(submissions.cik || '0'), accession),
    });
  }
  return result;
}

// EDGAR publishes the authoritative "ticker -> registrant CIK + series id"
// table for every ETF and mutual fund class; it is the reliable way to reach a
// fund's own N-PORT-P filing (the full-text search is only a last resort).
export type SecSeriesRef = { cik: string; seriesId: string; classId: string };

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const fields: string[] = Array.isArray(payload?.fields) ? payload.fields.map((field: unknown) => String(field)) : [];
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  const at = (row: unknown[], field: string): string => {
    const index = fields.indexOf(field);
    return index >= 0 ? String(row[index] ?? '') : '';
  };
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const ticker = sanitizeTicker(at(raw, 'symbol'));
    if (!ticker || map.has(ticker)) continue;
    const cik = at(raw, 'cik').replace(/\D/g, '');
    if (!cik || Number(cik) === 0) continue;
    map.set(ticker, {
      cik: cik.padStart(10, '0'),
      seriesId: at(raw, 'seriesId').toUpperCase(),
      classId: at(raw, 'classId').toUpperCase(),
    });
  }
  return map;
}

// Operating-company name -> exchange ticker, so N-PORT positions (which carry
// CUSIP/ISIN but never a ticker) still land in the watchlist with a symbol.
export function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.values(payload as JsonRecord) : [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as JsonRecord;
    const ticker = cleanHoldingTicker(record.ticker);
    const title = String(record.title ?? '');
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

export function edgarSeriesFilingsUrl(seriesId: string, count = 10): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: 'NPORT-P',
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: the newest N-PORT-P accessions of
// exactly that fund, newest first.
export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && form.toUpperCase() !== 'NPORT-P') continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    const hrefMatch = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body);
    const cikMatch = hrefMatch ? /\/edgar\/data\/(\d+)\//.exec(cleanText(hrefMatch[1])) : null;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
      url: nportUrlFor(cikMatch ? cikMatch[1] : accession.slice(0, 10), accession),
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

export type NportHolding = JsonRecord;

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: NportHolding[];
  totalValue: number;
  netAssets: number | null;
};

// Minimal, forgiving N-PORT-P XML reader (machine-generated schemas only),
// in the same spirit as SPDR's hand-rolled ZIP/OOXML workbook reader.
export function parseNport(xml: string): ParsedNport {
  const genInfoMatch = /<genInfo>([\s\S]*?)<\/genInfo>/i.exec(xml);
  const genInfo = genInfoMatch ? genInfoMatch[1] : String(xml || '').slice(0, 4000);
  const fundInfoMatch = /<fundInfo>([\s\S]*?)<\/fundInfo>/i.exec(xml);
  const fundInfo = fundInfoMatch ? fundInfoMatch[1] : '';
  const holdings: NportHolding[] = [];
  const blockRe = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  let block: RegExpExecArray | null;
  let totalValue = 0;
  while ((block = blockRe.exec(xml)) !== null) {
    const body = block[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
    if (!identifier) {
      // Real EDGAR schema: <identifiers><isin value="..."/><other value="..."/></identifiers>
      for (const tagMatch of body.matchAll(/<(isin|sedol|other|cusip)[^>]*value="([^"]+)"/gi)) {
        identifier = cleanText(tagMatch[2]);
        if (identifier) break;
      }
    }
    const weight = normalizeNumberText(tagValue(body, 'pctVal'));
    const valueMatch = /<valUSD[^>]*>([\s\S]*?)<\/valUSD>/i.exec(body);
    const value = Number(valueMatch ? valueMatch[1].replace(/[,\s]/g, '') : tagValue(body, 'curVal'));
    const balance = normalizeNumberText(tagValue(body, 'balance'));
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier || '-',
      Weight: weight === '' ? '0' : weight,
      'Market Value': Number.isFinite(value) ? String(value) : '0',
      'Shares Held': balance === '' ? '-' : balance,
      'Asset Category': tagValue(body, 'assetCat') || '-',
    });
    if (Number.isFinite(value)) totalValue += value;
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue,
    netAssets: numberOrNull(normalizeNumberText(tagValue(fundInfo, 'netAssets'))),
  };
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P, so the fallback finds the right filing without a hand-kept table;
// SPROTT_TRUST_CIK is only the last-resort default.
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
}

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };

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

export function isoDate(value: unknown): string | null {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(s);
  const result = m ? `${m[1]}-${m[2]}-${m[3]}` : us ? `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}` : null;
  return result && Number.isFinite(Date.parse(result)) ? result : null;
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
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
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

function holdingsRowFromCells(cells: string[]): JsonRecord {
  const [security, marketValue, symbol, sedol, quantity, weight] = cells;
  return {
    Name: cleanText(security),
    Ticker: cleanText(symbol),
    Identifier: cleanText(sedol),
    Weight: numberText(weight),
    'Market Value': numberText(marketValue),
    'Shares Held': numberText(quantity),
    SEDOL: cleanText(sedol),
  };
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
      const rows = body.filter((cells) => cells.some((cell) => cell !== '')).map((cells) => holdingsRowFromCsv(headers, cells));
      if (rows.length) return { rows, asOfDate, source: 'sprottetfs.com "Download All Holdings" CSV', headers: HOLDINGS_HEADERS };
    }
  }
  const table = tablesIn(source).find((candidate) => /<th[^>]*>\s*Security\s*<\/th>/i.test(candidate));
  if (!table) throw new Error('Holdings table not found on the fund page');
  const body = rowsIn(table).slice(1).map(cellsIn).filter((cells) => cells.length >= 6 && cells[0]);
  if (!body.length) throw new Error('Holdings table has no data rows');
  return { rows: body.map(holdingsRowFromCells), asOfDate, source: 'sprottetfs.com fund page holdings table', headers: HOLDINGS_HEADERS };
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
// SEC parsers above are shared with the sibling updaters. Resolver validates fund identity:
// the latest filing for a trust is NOT necessarily this ETF's filing.
let fundTickerPromise:Promise<Map<string,SecSeriesRef>>|null=null;
let companyTickerPromise:Promise<Map<string,string>>|null=null;
const submissionsCache=new Map<string,Promise<JsonRecord>>();
async function loadFundTickerMap(config:UpdaterConfig):Promise<Map<string,SecSeriesRef>> {
  return fundTickerPromise??=fetchJson(SEC_FUND_TICKERS_URL,'[ edgar    ] ticker table',secHeaders(config),config).then(parseFundTickerMap).catch(e=>{
    console.warn(`[ edgar    ] ticker table unavailable: ${errorMessage(e)} — retaining published data when needed`);return new Map();
  });
}
async function loadCompanyTickerMap(config:UpdaterConfig):Promise<Map<string,string>> {
  return companyTickerPromise??=fetchJson(SEC_COMPANY_TICKERS_URL,'[ edgar    ] company table',secHeaders(config),config).then(parseCompanyTickerMap).catch(e=>{outputNote(`[ edgar    ] ${errorMessage(e)}`);return new Map();});
}
export function nportMatches(fund:CatalogFund,parsed:ParsedNport,ref?:SecSeriesRef):boolean {
  if (ref && parsed.regCik.replace(/^0+/,'')!==ref.cik.replace(/^0+/,'')) return false;
  if (ref?.seriesId) return parsed.seriesId===ref.seriesId;
  // Exact normalized series name only: no first-filing or partial-name guesses.
  return parsed.seriesName.toLowerCase().replace(/[^a-z0-9]/g,'')===fund.name.toLowerCase().replace(/[^a-z0-9]/g,'');
}
async function resolveNportFiling(fund:CatalogFund,config:UpdaterConfig):Promise<JsonRecord|null> {
  const table=await loadFundTickerMap(config), ref=table.get(fund.ticker);
  let candidates:NportAccession[]=[];
  if (ref?.seriesId) {
    try {candidates=parseEdgarAtomFilings(await fetchText(edgarSeriesFilingsUrl(ref.seriesId),'[ edgar    ] series',secHeaders(config),config));}
    catch(e){outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  let cik=ref?.cik;
  if (!cik) {
    try {cik=pickEftsCik(await fetchJson(eftsSearchUrl(fund.name),'[ edgar    ] discovery',secHeaders(config),config),fund.name)??undefined;}
    catch(e){outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  // SPROTT FUNDS TRUST files every Sprott ETF's N-PORT; the XML series below
  // still has to match this fund before any holdings row is published.
  cik??=SPROTT_TRUST_CIK;
  if (!candidates.length && cik) {
    try {
      if (!submissionsCache.has(cik)) submissionsCache.set(cik,fetchJson(`${SEC_DATA_HOST}/submissions/CIK${cik}.json`,'[ edgar    ] submissions',secHeaders(config),config));
      candidates=parseNportAccessions(await submissionsCache.get(cik)!);
    } catch(e){outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  for (const accession of candidates.slice(0,40)) {
    try {
      const xml=await fetchText(accession.url,`[ edgar    ] ${fund.ticker} N-PORT`,secHeaders(config),config);
      const parsed=parseNport(xml);
      if (!nportMatches(fund,parsed,ref) || !parsed.holdings.length) continue;
      const names=await loadCompanyTickerMap(config);
      const rows=parsed.holdings.map(row=>({...row,Ticker:names.get(normalizeHoldingName(row.Name))||names.get(normalizeHoldingNameCore(row.Name))||''}));
      return {rows:sortHoldings(rows),headers:HOLDINGS_HEADERS,asOfDate:parsed.repPdDate,source:accession.url,status:'available'};
    } catch(e){outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(e)}`);}
  }
  return null;
}

async function optional<T>(label:string, action:()=>Promise<T>):Promise<T|null> {
  try {return await action();} catch(e){outputNote(`[ fallback ] ${label}: ${errorMessage(e)}`);return null;}
}
const percent=(v:number|null|undefined)=>v==null?'—':`${v.toFixed(2)}%`;
const money=(v:number|null|undefined)=>v==null?'—':`$${v.toFixed(2)}`;
export function mergeHistory(previous:JsonRecord[], fresh:ChartDay[]):JsonRecord[] {
  const byDate=new Map<string,JsonRecord>();
  for (const row of previous) {
    const epoch=Date.parse(String(row.Date));
    if (Number.isFinite(epoch)) byDate.set(new Date(epoch).toISOString().slice(0,10),row);
  }
  for (const row of historyRows(fresh)) {
    const key=new Date(Date.parse(row.Date)).toISOString().slice(0,10), published=byDate.get(key);
    // Yahoo recomputes adjusted closes on every request. A value that sits on
    // a .xx5 rounding boundary flips the published cent back and forth between
    // otherwise identical requests, and the feed would churn on every run.
    // A published row therefore keeps its cent while the fresh value moves by
    // less than two cents; a genuine restatement or dividend adjustment is
    // larger and replaces the row normally.
    const freshAdj=numberOrNull(row['Adj Close']), publishedAdj=published?numberOrNull(published['Adj Close']):null;
    if (freshAdj!==null && publishedAdj!==null && Math.abs(freshAdj-publishedAdj)<0.02) row['Adj Close']=published!['Adj Close'];
    byDate.set(key,row);
  }
  return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
}
function chartDaysFromRows(rows:JsonRecord[]):ChartDay[] {
  return rows.flatMap(row=>{
    const date=new Date(Date.parse(String(row.Date))), close=numberOrNull(row.Close), adjClose=numberOrNull(row['Adj Close']);
    return Number.isFinite(date.getTime())&&close!==null&&adjClose!==null?[{date:date.toISOString().slice(0,10),close,adjClose,volume:numberOrNull(row.Volume)??0}]:[];
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
  const s = String(text ?? '').trim();
  const iso = isoDate(s);
  if (iso) return iso;
  const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  if (month < 0) return null;
  const out = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return Number.isFinite(Date.parse(out)) ? out : null;
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
const RETURN_KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'returnsBasis', 'performanceAsOf'];
/** Previous return metrics as one unit (values + returnsBasis + performanceAsOf), or nothing when none were published. */
export function retainReturns(metrics: JsonRecord, previous: JsonRecord | null | undefined): JsonRecord {
  if (!previous || previous.performanceAsOf === undefined) return {};
  return Object.fromEntries(RETURN_KEYS.filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]]));
}
export function buildMetrics(month:JsonRecord|null,derived:PriceReturns,secYield:number|null,divYield:number|null,returnsBasis:string,performanceAsOf:string|null):JsonRecord {
  const ytd=month?.ytd??derived.ytd, tr1y=month?.yr1??derived.yr1;
  const cagr3y=month?.yr3??derived.cagr3y,cagr5y=month?.yr5??derived.cagr5y,cagr10y=month?.yr10??derived.cagr10y;
  return {ytd,tr1y,cagr3y,cagr5y,cagr10y,tr3y:annualizedToTotal(cagr3y,3),tr5y:annualizedToTotal(cagr5y,5),tr10y:annualizedToTotal(cagr10y,10),
    siAnn:month?.sinceInception??derived.siAnn,secYield,secYieldText:percent(secYield),dividendYield:divYield,dividendYieldText:percent(divYield),returnsBasis,performanceAsOf};
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

  let holdings: JsonRecord | null = null;
  const pageRows: JsonRecord[] = page?.holdings?.rows ?? [];
  if (pageRows.length) {
    holdings = { rows: sortHoldings(pageRows), headers: HOLDINGS_HEADERS, asOfDate: page?.holdings?.asOfDate ?? null, source: page?.holdings?.source ?? 'sprottetfs.com fund page', status: 'available' };
  }
  if (!holdings && config.edgarFallback) holdings = await optional(`${ticker} SEC holdings`, () => resolveNportFiling(fund, config));
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
    return parseChart(raw);
  });
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
  const quarter: JsonRecord | null = page?.performance?.quarter ?? old.returns?.quarterEnd ?? null;
  const anchor = monthAnchor(month, days);
  const usable = anchor ? days.filter((day) => Date.parse(day.date) <= anchor.getTime()) : [];
  const derived = usable.length ? priceReturns(usable, anchor!) : { ...EMPTY_PRICE_RETURNS };
  // A range-limited Yahoo download is not a since-inception return.
  if (!chart?.firstTradeDate || !days.length || Date.parse(days[0].date) / 1000 - chart.firstTradeDate > 7 * 86400) derived.siAnn = null;
  const hasOfficialReturns = Boolean(page?.performance?.month) || Boolean(month && !String(old.returns?.derivedFrom ?? '').startsWith('Yahoo adjusted'));
  const returnsBasis = hasOfficialReturns
    ? 'official sprottetfs.com month-end/quarter-end average annual total returns (NAV); missing metrics derived from Yahoo adjusted closes at the same reporting date'
    : 'Yahoo adjusted market-price returns, not official NAV';
  const metrics = buildMetrics(month, derived, secYield, divYield, returnsBasis, performanceAsOfDate(hasOfficialReturns, month, derived));
  if (month) month = { ...month, ytd: month.ytd ?? derived.ytd, mo1: month.mo1 ?? derived.mo1, qtd: month.qtd ?? derived.qtd };
  else if (usable.length) month = { asOfDate: formatEdgarDate(derived.asOfDate!), mo1: derived.mo1, qtd: derived.qtd, ytd: derived.ytd, yr1: derived.yr1, yr3: derived.cagr3y, yr5: derived.cagr5y, yr10: derived.cagr10y, sinceInception: derived.siAnn };
  const filtered = fundFilterReasons({ ticker, aumValue: aum, terValue: ter, metrics }, config);
  if (filtered.length) return null;
  // Returns come from the official table or Yahoo closes; if neither answered, keep the previous
  // returns together with the date and basis they describe (never old values under a new date).
  if (!page?.performance?.month && !chart?.days.length) Object.assign(metrics, retainReturns(metrics, previousIndex.metrics));
  if (!page && !chart && !Object.keys(old).length) throw new Error(`${ticker}: no usable per-fund source`);
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
export function batchSelection(funds:CatalogFund[],config:UpdaterConfig,cursor:string|null):CatalogFund[] {
  const selected=funds.filter(f=>!config.tickers.length||config.tickers.includes(f.ticker));
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
  const controls=await runtimeControls(env);
  if(controls.VERBOSE!==undefined)process.env.VERBOSE=controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA??'auto');
  const config=readConfig(controls); configureRequestPacing(config.concurrency,config.requestSleep*1000);
  outputPrintConfig('Sprott',config);
  const previous=await readJson(INDEX_FILE), oldFunds=new Map<string,JsonRecord>((previous?.funds??[]).map((f:JsonRecord)=>[f.ticker,f]));
  let catalog:CatalogFund[]|null=null;
  if (!config.skipSprott) catalog=await optional('catalog',()=>loadCatalog(config));
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
  const newFunds=oldFunds.size?catalog.filter(f=>!oldFunds.has(f.ticker)).map(f=>f.ticker):[];
  if (newFunds.length) {
    console.log(`NEW FUNDS: ${newFunds.join(', ')}`);
    if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`NEW FUNDS: ${newFunds.join(', ')}\n\n`);
  }
  if (!catalog.length) throw new Error('No official or previously published catalog; refusing empty success');
  console.log(`[ catalog  ] ${catalog.length} Sprott ETFs (sprottetfs.com fund navigation / published fallback)`);
  const state=await readJson(STATE_FILE), queue=batchSelection(catalog,config,state?.cursor??null);
  outputPrintFilter(queue.length,catalog.length,outputHasOutputFilters(config));
  const reporter=outputCreateReporter(API_ROOT,queue.length), result=new Map(oldFunds);
  let failures=0,processed=0,skipped=0,deferred=0;
  const deadline=Date.now()+SOFT_DEADLINE_MS;
  await runPool(queue,config.concurrency,async(fund)=>{
    if(Date.now()>deadline){deferred++;return;} // stop taking new funds; the index is still written
    const before=await reporter.before(fund.ticker);
    try {
      const row=await processFund(fund,config,oldFunds.get(fund.ticker)??{});
      if(row){result.set(fund.ticker,row);processed++;}
      else skipped++;
      await reporter.result(fund.ticker,before,row?undefined:'skipped');
    } catch(e) {failures++;await reporter.result(fund.ticker,before,'failed',errorMessage(e));}
  });
  if (!result.size) throw new Error('No publishable funds; not replacing the index');
  const funds=[...result.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
  const counts={funds:funds.length,holdings:funds.reduce((s,f)=>s+f.holdings,0),history:funds.reduce((s,f)=>s+f.history,0)};
  const indexBody={source:{provider:'Sprott ETFs',site:SPROTT_SITE,catalog:CATALOG_PAGE},counts,funds};
  if(!samePublishedContent(JSON.stringify(withoutStamps(previous)),indexBody)){
    const stamp=isoSeconds();
    await writeIfChanged(INDEX_FILE,{generatedAt:stamp,catalogReadAt:stamp,...indexBody});
  }
  // Cursor follows deterministic queue order, not asynchronous completion order.
  // Failed batches leave the cursor in place so the next run retries them.
  if (config.maxFetches && !failures && !deferred && queue.length) await writeIfChanged(STATE_FILE,{cursor:queue.at(-1)!.ticker});
  else if (!config.maxFetches && !failures && !deferred && !config.tickers.length) await rm(STATE_FILE,{force:true});
  console.log(`[ done     ] ${processed} funds processed, ${skipped} skipped, ${failures} failures${deferred?`, ${deferred} deferred (soft deadline)`:''}`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings} holdings rows / ${counts.history} history rows`);
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
