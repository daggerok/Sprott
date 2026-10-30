/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONTROL_NAMES, HOLDINGS_HEADERS, USAGE, catalogOnlyRow, closedFund, configureRequestPacing, createRequestGate, fetchWithRetry, annualizedToTotal, batchSelection, buildMetrics, dividendYieldBasis, withYieldBasis,
  chartDaysFromRows, holdingsGuard, holdingsWeightCount, indicatedYield, inferDistributionFrequency, installSystemCa, isCertError, isoDate, mergeHistory, ADJ_CLOSE_NOISE, monthAnchor, normalizeCusip,
  nportHoldingsSheet, nportIsFresh, nportTickers, parseCatalogNav, parseFeesTable, parseFundPage, parseHoldingsSection, parseLongDate, parseMoneyText, parseNportFiling, parsePercentText,
  parseDistributionsSection, parseReturnTable, parseSecCompanyNames, parseSecFundTickers, parseSitemapFundPages, parseSprottPerformance, performanceAsOfDate,
  priceReturns, readConfig, resolveControls, retainReturns, runPool, runtimeControls, samePublishedContent, storedDateIso,
  tickerFromSlug, toIsoDate, totalToAnnualized, withoutStamps, FETCH_TIMEOUT_MS,
} from './update-data';
import type { CatalogFund } from './update-data';

// ---------------------------------------------------------------------------
// Shared setup: clean environment, pinned TZ, restored fetch / exit code / console
// ---------------------------------------------------------------------------
const scriptsDir = new URL('.', import.meta.url).pathname;
const file = JSON.parse(readFileSync(join(scriptsDir, 'update-data.config.json'), 'utf8')) as Record<string, string>;
const realFetch = globalThis.fetch;
const realExitCode = process.exitCode;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const realSetTimeout = globalThis.setTimeout;
const savedEnv = { ...process.env };
const tempDirs: string[] = [];
const isControlVar = (key: string): boolean =>
  (CONTROL_NAMES as readonly string[]).includes(key) || key.startsWith('SPROTT_') || ['HISTORICAL_PAGE_SIZE', 'NODE_USE_SYSTEM_CA', 'ETF_UPDATER_SYSTEM_CA', 'GITHUB_STEP_SUMMARY'].includes(key);

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (isControlVar(key)) delete process.env[key];
  process.env.TZ = 'UTC';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  process.exitCode = realExitCode ?? 0;
  Object.assign(console, realConsole);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  configureRequestPacing(2, 1000);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Small inline samples shaped like the sprottetfs.com pages (no captured files)
// ---------------------------------------------------------------------------
const holdingsCsv = [
  'Security,Symbol,SEDOL,Weight,Market Value,Quantity',
  'Cameco Corp.,CCJ,2158684,99.85,376658199.63,4345889',
  'Cash Equivalent,,,0.15,2757000.00,',
].join('\n');
const holdingsTable = '<table><tr><th>Security</th><th>Market Value</th><th>Symbol</th><th>SEDOL</th><th>Quantity</th><th>Weight</th></tr>'
  + '<tr><td>Cameco Corp.</td><td>376,658,199.63</td><td>CCJ</td><td>2158684</td><td>4,345,889</td><td>99.85</td></tr>'
  + '<tr><td>Cash Equivalent</td><td>2,757,000.00</td><td></td><td></td><td></td><td>0.15</td></tr></table>';
const perfTable = (rows: string): string => '<table><tr><td>Fund</td><td>1 MO*</td><td>3 MO*</td><td>YTD*</td><td>1 YR</td><td>3 YR</td><td>5 YR</td><td>10 YR</td><td>S.I.</td></tr>'
  + rows + '</table>';
const table = (header: string[], rows: string[][]): string =>
  `<table><tr>${header.map((cell) => `<td>${cell}</td>`).join('')}</tr>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</table>`;
const pageHtml = (opts: { csv?: boolean; breadcrumb?: string; ticker?: string } = {}): string => `<html><head>
<script type="application/ld+json">${JSON.stringify({ '@graph': [
  { '@type': 'InvestmentFund', name: 'Sprott Uranium Miners ETF' },
  { '@type': 'BreadcrumbList', itemListElement: [{ item: opts.breadcrumb ?? 'https://sprottetfs.com/critical-materials/' }] },
] })}</script></head><body>
<h2 id="asOfDate">As of September 30, 2026</h2>
<section><h3 class="color-gold">NAV</h3><h4>$47.63</h4><h3 class="color-gold">Market Price</h3><h4>$47.50</h4>
<h3 class="color-gold">Premium/Discount</h3><h4>-0.27%</h4><h3 class="color-gold">Ticker</h3><h4>${opts.ticker ?? 'URNM'}</h4>
<h3 class="color-gold">Total Net Asset Value</h3><h4>$1.84 Billion</h4></section>
<section><h3 class="color-gold">ISIN</h3><h4>ISIN: US85208P3038</h4><h3 class="color-gold">CUSIP</h3><h4>CUSIP: 85208P303</h4>
<h3 class="color-gold">Benchmark Index</h3><h4>URNMX</h4><h3 class="color-gold">Listing Exchange</h3><h4>NYSE Arca</h4>
<h3 class="color-gold">Inception Date</h3><h4>December 3, 2019</h4><h3 class="color-gold">Index Rebalance Frequency</h3><h4>Quarterly</h4>
<h3 class="color-gold">Net Total Expense Ratio</h3><h4>0.75%</h4></section>
<table><tr><td>Management Fee</td><td>0.75%</td></tr><tr><td>Other Expenses</td><td>0.00%</td></tr>
<tr><td>Total Annual Fund Operating Expenses</td><td>0.75%</td></tr></table>
<h3>Month-End Performance</h3><p>Average Annual Total Returns (%) As of 9/30/2026</p>
${perfTable('<tr><td>Sprott Uranium Miners ETF (Net Asset Value)</td><td>-16.37</td><td>-9.16</td><td>-13.32</td><td>-18.52</td><td>3.44</td><td>8.01</td><td>--</td><td>25.01</td></tr>')}
<h3>Quarter-End Performance</h3><p>Average Annual Total Returns (%) As of 9/30/2026</p>
${perfTable('<tr><td>Sprott Uranium Miners ETF (Net Asset Value)</td><td>-16.37</td><td>-9.16</td><td>-13.32</td><td>-18.52</td><td>3.44</td><td>8.01</td><td>--</td><td>25.01</td></tr>')}
<div class="holdings-table"><p class="update-date">As of 9/30/2026</p>
${opts.csv === false ? '' : `<a href="data:application/csv;charset=utf-8,${encodeURIComponent(holdingsCsv)}">Download All Holdings</a>`}
${holdingsTable}</div>
<table id="DistributionsData"><tr><td>Ex-Date</td><td>Total Distributions</td></tr>
<tr><td>12/18/2025</td><td>$1.74</td></tr><tr><td>12/15/2022</td><td>-</td></tr><tr><td>12/14/2023</td><td>$1.75</td></tr></table>
</body></html>`;

// ===========================================================================
describe('controls', () => {
  test('precedence: file < advanced < nonblank inputs < env, brand alias beats bare name', () => {
    expect(resolveControls(
      { CONCURRENCY: 2, TICKERS: 'URNM' }, { CONCURRENCY: 3, TICKERS: 'SETM' }, { CONCURRENCY: '4', TICKERS: '' }, { SPROTT_CONCURRENCY: '5' },
    )).toEqual({ CONCURRENCY: '5', TICKERS: 'SETM' });
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolveControls({ TICKERS: 'URNM' }, {}, {}, { SPROTT_TICKERS: 'SETM', TICKERS: 'COPJ' }).TICKERS).toBe('SETM');
  });

  test('blank inputs inherit, advanced can clear a key, an explicitly empty env var wins', () => {
    expect(resolveControls({ TICKERS: 'URNM' }, {}, { TICKERS: '' }).TICKERS).toBe('URNM');
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: 'SETM' }, { TICKERS: 'URNJ' }, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('legacy env aliases keep working', () => {
    expect(resolveControls({}, {}, {}, { SPROTT_LIMIT: '3' }).MAX_FETCHES).toBe('3');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
  });

  test('strict validation rejects bad values, unknown keys and CR/LF/NUL, never falls back silently', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' },
      { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_RETRIES: '1.5' }, { MAX_FETCHES: 1.5 },
      { HOLDINGS_PAGE_SIZE: 0 }, { HISTORY_PAGE_SIZE: 'x' }, { REQUEST_SLEEP: '-1' }, { REQUEST_SLEEP: 'abc' },
      { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { SKIP_YAHOO: 'perhaps' },
      { AUM: '1:2:3' }, { AUM: '5' }, { TER: '2:1' }, { PERFORMANCE_1Y: 'a:b' }, { TOTAL_RETURN_10Y: '1' },
      { TICKERS: ['URNM'] }, { TICKERS: { a: 1 } }, { TICKERS: null },
    ]) {
      expect(() => resolveControls(value)).toThrow();
      expect(() => resolveControls({}, value)).toThrow();
    }
    for (const bad of [null, [], 'x', 1]) expect(() => resolveControls(bad)).toThrow();
    expect(() => resolveControls({}, {}, {}, { SPROTT_SEC_UA: 'a\nb' })).toThrow();
    for (const key of ['CONCURRENCY', 'MAX_RETRIES', 'MAX_FETCHES', 'REQUEST_SLEEP']) {
      expect(() => resolveControls({}, {}, {}, { [key]: '' })).toThrow();
    }
    expect(() => readConfig({ CONCURRENCY: 'abc' })).toThrow();
    expect(readConfig(resolveControls({ MAX_RETRIES: 1, MAX_FETCHES: 0 })).maxRetries).toBe(1);
  });

  test('config file: keys equal CONTROL_NAMES, values are strings, the scheduled path equals the defaults', async () => {
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(resolveControls(file, {}, {}, {})).toEqual(file);
    const config = readConfig(resolveControls(file));
    expect([config.tickers, config.maxFetches, config.concurrency, config.maxRetries, config.historyRange])
      .toEqual([[], 0, 2, 2, 'max']);
    expect([config.skipSprott, config.skipYahoo, config.edgarFallback, config.storeRawDownloads]).toEqual([false, false, true, false]);
    expect((await runtimeControls({})).SEC_UA).toBe(file.SEC_UA);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    expect((await runtimeControls({ SPROTT_TICKERS: 'URNM' })).TICKERS).toBe('URNM');
  });
});

describe('controls 2', () => {
  test('filters, history range and tickers flow through readConfig', () => {
    const config = readConfig(resolveControls({
      HISTORY_RANGE: '5y', AUM: '100M:', TER: ':0.7', TICKERS: 'urnm, setm;URNJ', PERFORMANCE_1Y: '10:', TOTAL_RETURN_YTD: ':-1',
    }));
    expect(config.historyRange).toBe('5y');
    expect(config.tickers).toEqual(['URNM', 'SETM', 'URNJ']);
    expect(config.terRange?.max).toBe(0.7);
    expect(config.aumRange?.min).toBe(100_000_000);
    expect(config.performanceRanges['1Y']?.min).toBe(10);
    expect(config.totalReturnRanges.YTD?.max).toBe(-1);
    expect(readConfig(resolveControls({ AUM: 'small' })).aumRange).toEqual({ min: 300_000_000, max: 2_000_000_000 });
  });

  test('TICKERS filters and MAX_FETCHES resumes from the cursor, wrapping and skipping unselected funds', () => {
    const fund = (ticker: string): CatalogFund => ({
      ticker, name: ticker, fundPage: `https://sprottetfs.com/${ticker.toLowerCase()}-etf/`, assetClass: '', isin: '', nav: null, navDate: null,
    });
    const funds = ['COPJ', 'COPP', 'GBUG', 'URNM'].map(fund);
    const tickers = (config: ReturnType<typeof readConfig>, cursor: string | null) => batchSelection(funds, config, cursor).map((item) => item.ticker);
    expect(tickers(readConfig(resolveControls({ TICKERS: 'URNM COPP' })), null)).toEqual(['COPP', 'URNM']);
    const bounded = readConfig(resolveControls({ MAX_FETCHES: '2' }));
    expect(tickers(bounded, null)).toEqual(['COPJ', 'COPP']);
    expect(tickers(bounded, 'COPJ')).toEqual(['COPP', 'GBUG']);
    expect(tickers(bounded, 'URNM')).toEqual(['COPJ', 'COPP']);
    const narrow = readConfig(resolveControls({ TICKERS: 'COPJ URNM', MAX_FETCHES: '1' }));
    expect([tickers(narrow, 'GBUG'), tickers(narrow, 'URNM'), tickers(narrow, 'ZZZZ')]).toEqual([['URNM'], ['COPJ'], ['COPJ']]);
  });

  test('USE_SYSTEM_CA: auto by default, case-insensitive, restart only on certificate errors', async () => {
    expect(resolveControls(file).USE_SYSTEM_CA).toBe('auto');
    for (const mode of ['auto', 'true', 'false']) {
      expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: mode.toUpperCase() }).USE_SYSTEM_CA).toBe(mode);
    }
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);

    console.error = () => {};
    let restarts = 0;
    const reexec = (() => { restarts++; return undefined as never; }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    globalThis.fetch = (async () => { throw new Error('unable to get local issuer certificate'); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await globalThis.fetch('https://example.invalid/');
    expect(restarts).toBe(1);
    globalThis.fetch = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(globalThis.fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(restarts).toBe(1);
  });

  test('--help lists every control independent of the cwd and redacts the SEC contact', async () => {
    const child = Bun.spawn([process.execPath, join(scriptsDir, 'update-data.ts'), '--help'], {
      cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/);
      expect(USAGE).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
      expect(help).toContain(name);
    }
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({}).secUa).toBe(file.SEC_UA);
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(help).toContain('SEC_UA=<redacted>');
    expect(help.slice(help.indexOf('[ config'))).not.toContain('gmail.com');
  });
});

// ===========================================================================
describe('parsing', () => {
  test('fund page: pricing, key facts, identifiers, fees and returns; "--" becomes null, never 0', () => {
    const page = parseFundPage(pageHtml(), 'URNM');
    expect([page.ticker, page.name, page.category, page.asOfDate]).toEqual(['URNM', 'Sprott Uranium Miners ETF', 'Critical Materials', '2026-09-30']);
    expect([page.nav, page.marketPrice, page.premiumDiscount, page.aumValue]).toEqual([47.63, 47.5, -0.27, 1840000000]);
    expect(page.expenseRatio).toEqual({ gross: 0.75, net: 0.75, value: 0.75 });
    expect(page.identifiers).toEqual({ isin: 'US85208P3038', cusip: '85208P303', indexTicker: 'URNMX' });
    expect([page.exchange, page.inception, page.indexRebalanceFrequency]).toEqual(['NYSE Arca', '2019-12-03', 'Quarterly']);
    expect(page.performance.month).toMatchObject({
      asOfDate: 'Sep 30 2026', mo1: -16.37, qtd: -9.16, ytd: -13.32, yr1: -18.52, yr3: 3.44, yr5: 8.01, yr10: null, sinceInception: 25.01,
    });
    expect(page.performance.quarter).toEqual(page.performance.month);
    expect(parseFeesTable(pageHtml())).toEqual({ 'Management Fee': 0.75, 'Other Expenses': 0, 'Total Annual Fund Operating Expenses': 0.75 });
    expect(parseFundPage(pageHtml({ breadcrumb: 'https://sprottetfs.com/' }), 'METL').category).toBeNull();
    expect(parseFundPage(pageHtml().replace('CUSIP: 85208P303', 'CUSIP: 85208P 303'), 'URNM').identifiers.cusip).toBe('85208P303');
    expect(normalizeCusip('')).toBeNull();
  });

  test('holdings come from the page CSV, the rendered table is an equivalent fallback', () => {
    const holdings = parseHoldingsSection(pageHtml());
    expect(holdings.asOfDate).toBe('2026-09-30');
    expect(holdings.rows).toHaveLength(2);
    expect(holdings.rows[0]).toEqual({
      Name: 'Cameco Corp.', Ticker: 'CCJ', Identifier: '2158684',
      Weight: '99.85', 'Market Value': '376658199.63', 'Shares Held': '4345889', SEDOL: '2158684',
    });
    expect(holdings.rows[1]).toMatchObject({ Name: 'Cash Equivalent', Ticker: '', Weight: '0.15' });
    const fallback = parseHoldingsSection(pageHtml({ csv: false }));
    expect(fallback.source).toContain('holdings table');
    expect(fallback.rows).toEqual(holdings.rows);
  });

  test('distributions skip placeholder rows, sort by date, keep real amounts and never produce a zero', () => {
    const page = parseFundPage(pageHtml(), 'URNM');
    expect(page.distributions.payments.map((payment: { amount: number }) => payment.amount)).toEqual([1.75, 1.74]);
    const parsed = parseDistributionsSection('<table id="DistributionsData"><tr><td>Ex-Date</td><td>Record Date</td><td>Total Distributions</td></tr>'
      + '<tr><td>12/18/2025</td><td>12/18/2025</td><td>$1.74</td></tr></table>');
    expect(parsed.headers).toEqual(['Ex-Date', 'Amount']);
    expect(parsed.payments).toEqual([{ epoch: Date.parse('2025-12-18T00:00:00Z') / 1000, amount: 1.74 }]);
    expect(parseDistributionsSection('<table id="DistributionsData"><tr><td>Ex-Date</td><td>Total Distributions</td></tr>'
      + '<tr><td>12/15/2022</td><td>-</td></tr><tr><td>n/a</td><td>$0.00</td></tr></table>').payments).toEqual([]);
  });

  test('catalog: the sitemap yields only canonical fund pages, the navigation list skips anchors', () => {
    const sitemap = ['copj-sprott-junior-copper-miners-etf/', 'urnm-sprott-uranium-miners-etf', 'rexc-rare-earths-ex-china-etf/', 'sprott-precious-metals-etfs/', 'insights/foo/']
      .map((slug) => `<url><loc>https://sprottetfs.com/${slug}</loc></url>`).join('\n');
    const pages = parseSitemapFundPages(sitemap);
    expect(pages.map(tickerFromSlug)).toEqual(['COPJ', 'REXC', 'URNM']);
    expect(pages[2]).toBe('https://sprottetfs.com/urnm-sprott-uranium-miners-etf/');
    const nav = ['COPJ', 'URNM', 'SETM'].map((ticker) => `<a href="/${ticker.toLowerCase()}-sprott-etf" title="Sprott ${ticker} ETF" class=" phv-btn purple-bg large">${ticker}</a>`).join('')
      + '<a href="#secPurchase" title="Invest" class=" phv-btn gry-bg large">Invest Now</a>';
    const funds = parseCatalogNav(nav);
    expect(funds.map((fund) => fund.ticker)).toEqual(['COPJ', 'SETM', 'URNM']);
    expect(funds.find((fund) => fund.ticker === 'URNM')!.fundPage).toBe('https://sprottetfs.com/urnm-sprott-etf/');
  });

  test('return table: any column order, real zero and negatives kept, placeholders null, benchmark rows ignored', () => {
    const columns: Array<[string, string]> = [
      ['S.I.', '25.01'], ['YTD*', '-13.32'], ['10 YR', '--'], ['Fund', 'Sprott Uranium Miners ETF (Net Asset Value)'],
      ['1 MO*', '-16.37'], ['3 MO*', '-9.16'], ['Unknown', 'x'], ['1 YR', '-18.52'], ['5 YR', '8.01'], ['3 YR', '3.44'],
    ];
    expect(parseReturnTable(table(columns.map(([header]) => header), [columns.map(([, value]) => value)]))).toEqual({
      ytd: -13.32, yr1: -18.52, yr3: 3.44, yr5: 8.01, yr10: null, sinceInception: 25.01, mo1: -16.37, qtd: -9.16,
    });
    const values = table(['Fund', '1 MO*', '3 MO*', 'YTD*', '1 YR', '3 YR', '5 YR', '10 YR', 'S.I.1'], [
      ['Sprott Gold Miners ETF (Market Price)', '9', '9', '9', '9', '9', '9', '9', '9'],
      ['Some Benchmark (Benchmark)', '1', '1', '1', '1', '1', '1', '1', '1'],
      ['Sprott Gold Miners ETF (Net Asset Value)', '0', '-7.5', '--', '', 'n/a', '-0.01', '12', '--'],
    ]);
    expect(parseReturnTable(values)).toEqual({ ytd: null, yr1: null, yr3: null, yr5: -0.01, yr10: 12, sinceInception: null, mo1: 0, qtd: -7.5 });
    expect(Object.values(parseReturnTable(table(['a', 'b'], [['1', '2']])))).toEqual(Array(8).fill(null));
  });
});

describe('parsing 2', () => {
  test('performance blocks need their published "As of" date', () => {
    const page = parseSprottPerformance('<h3>Month-End Performance</h3><p class="small">Average Annual Total Returns (%) As of 9/30/2026</p>'
      + table(['Fund', '1 MO*'], [['Sprott Uranium Miners ETF (Net Asset Value)', '1']]));
    expect([page.month, page.quarter]).toEqual([null, null]);
  });

  test('N-PORT freshness: a report replaces published holdings only when strictly newer; nothing published accepts any report', () => {
    expect([nportIsFresh('2026-07-31', '2026-10-22', 26), nportIsFresh('2026-10-22', '2026-10-22', 26), nportIsFresh('2026-10-31', '2026-10-22', 26)]).toEqual([false, false, true]);
    expect([nportIsFresh('', '2026-10-22', 26), nportIsFresh('2026-07-31', null, 0), nportIsFresh('2026-07-31', undefined, undefined)]).toEqual([false, true, true]);
    expect(nportIsFresh('2026-10-31', null, 26)).toBe(false); // published rows without a date cannot be compared: keep them
    // the published display date is converted first: meta.holdings.asOf "Oct 22 2026" is the same day as asOfDate
    expect(nportIsFresh('2026-10-31', storedDateIso('Oct 22 2026'), 26)).toBe(true);
  });

  test('money and percent text keep decoration out and unknown text as null', () => {
    expect([parseMoneyText('$47.63'), parseMoneyText('-$0.57'), parseMoneyText('$1.84 Billion'), parseMoneyText('526.07 Million'), parseMoneyText('—')])
      .toEqual([47.63, -0.57, 1840000000, 526070000, null]);
    expect([parsePercentText('-0.27%'), parsePercentText('0.75%'), parsePercentText('Quarterly')]).toEqual([-0.27, 0.75, null]);
  });

  test('holdings guard: header-only, renamed weight column, broken weights, a bad weight sum and a halved sheet are rejected', () => {
    const headers = ['Name', 'Ticker', 'Weight'];
    const rows = [{ Name: 'A', Ticker: 'A', Weight: '60%' }, { Name: 'B', Ticker: 'B', Weight: '40%' }];
    expect(holdingsGuard(headers, rows, 2)).toBeNull();
    expect(holdingsGuard(headers, [['A', 'A', '60'], ['B', 'B', '40']], null)).toBeNull();
    expect(holdingsGuard([], [], 0)).toBeNull(); // nothing published before: an empty sheet is honest
    expect(holdingsGuard(headers, [], 505)).toContain('no holdings rows');
    expect(holdingsGuard(['Name', 'Ticker', 'Wt'], rows, 2)).toContain('no weight column');
    expect(holdingsGuard(headers, rows.map((row) => ({ ...row, Weight: '6\u200B0' })), 2)).toContain('numeric weight');
    const allocation = [{ Name: 'Cash&Collateral', Ticker: '-', Weight: '100' }, { Name: 'Equities', Ticker: '-', Weight: '476' }];
    expect(holdingsGuard(headers, allocation, 2)).toContain('outside 50..150');
    expect(holdingsGuard(headers, allocation, 2, ['sum'])).toBeNull();
    expect(holdingsGuard(headers, rows, 5)).toContain('less than half');
  });

  test('SEC EDGAR fallback (shared nport-reader): sheet keys equal the published headers (SEDOL, no Asset Category), empty missing numbers, no derivative identifiers, tickers only for U.S. equities', () => {
    const map = parseSecFundTickers({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1728683, 'S000068011', 'C000220000', 'URNM'], [1728683, 'S000078421', 'C000239100', 'URNJ']] });
    expect(map.get('URNM')).toEqual({ cik: '0001728683', seriesId: 'S000068011', classId: 'C000220000' });
    const filing = parseNportFiling(`<?xml version="1.0"?><edgarSubmission><formData><genInfo>
      <regName>SPROTT FUNDS TRUST</regName><regCik>0001728683</regCik><seriesName>Sprott Uranium Miners ETF</seriesName><seriesId>S000068011</seriesId>
      <repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1500000000</netAssets></fundInfo><invstOrSecs>
      <invstOrSec><name>Cameco Corp.</name><cusip>13321L108</cusip><identifiers><isin value="CA13321L1085"/><other otherDesc="SEDOL" value="2158684"/></identifiers><balance>4345889</balance><curCd>CAD</curCd><valUSD>376658199.63</valUSD><pctVal>20.49</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>Uranium Energy Corp</name><cusip>916896103</cusip><identifiers><isin value="US9168961038"/></identifiers><balance>100</balance><curCd>USD</curCd><valUSD>1500</valUSD><pctVal>0.5</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>Goldman Sachs Financial Square Government Fund</name><cusip>38141W273</cusip><identifiers><ticker value="FGTXX"/></identifiers><balance>2757000</balance><curCd>USD</curCd><valUSD>2757000</valUSD><assetCat>STIV</assetCat></invstOrSec>
      <invstOrSec><name>URANIUM FUTURE</name><cusip>000000000</cusip><identifiers><other otherDesc="Bloomberg Identifier" value="BBG01UXU0000"/></identifiers><curCd>USD</curCd><valUSD>-1200</valUSD><pctVal>-0.01</pctVal><assetCat>DCO</assetCat><derivativeInfo><futrDeriv derivCat="FUT"><descRefInstrmnt><otherRefInst><identifiers><cusip value="13321L108"/><ticker value="CCJ"/></identifiers></otherRefInst></descRefInstrmnt></futrDeriv></derivativeInfo></invstOrSec>
      </invstOrSecs></formData></edgarSubmission>`);
    expect([filing.regName, filing.seriesId, filing.repPdDate, filing.netAssets, filing.positions.length]).toEqual(['SPROTT FUNDS TRUST', 'S000068011', '2026-06-30', 1500000000, 4]);
    const sheet = nportHoldingsSheet(filing, nportTickers(filing.positions, parseSecCompanyNames({ 0: { ticker: 'CCJ', title: 'CAMECO CORP' }, 1: { ticker: 'UEC', title: 'URANIUM ENERGY CORP' } })));
    expect(sheet.headers).toEqual(HOLDINGS_HEADERS);
    expect(HOLDINGS_HEADERS).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'SEDOL']);
    // every row carries exactly the published headers: the SEDOL column holds the SEDOL, nothing is published under a hidden key
    for (const row of sheet.rows) expect(Object.keys(row)).toEqual(HOLDINGS_HEADERS);
    // sorted by weight; the CAD listing gets no U.S. ticker, the future keeps its own id (never CCJ's), the money fund has no weight: empty, never 0
    expect(sheet.rows.map((row) => [row.Name, row.Ticker, row.Identifier, row.Weight, row['Market Value'], row['Shares Held'], row.SEDOL])).toEqual([
      ['Cameco Corp.', '-', '13321L108', '20.49', '376658199.63', '4345889', '2158684'],
      ['Uranium Energy Corp', 'UEC', '916896103', '0.5', '1500', '100', '-'],
      ['URANIUM FUTURE', '-', 'BBG01UXU0000', '-0.01', '-1200', '', '-'],
      ['Goldman Sachs Financial Square Government Fund', '-', '38141W273', '', '2757000', '2757000', '-'],
    ]);
  });
});

// ===========================================================================
describe('parsing 3', () => {
  test('the holdings table is read by its header text: a reordered table maps every column, a missing Security or Weight column fails', () => {
    const reordered = '<div class="holdings-table"><table><tr><th>Weight</th><th>SEDOL</th><th>Security</th><th>Quantity</th><th>Symbol</th><th>Market Value</th></tr>'
      + '<tr><td>99.85</td><td>2158684</td><td>Cameco Corp.</td><td>4,345,889</td><td>CCJ</td><td>376,658,199.63</td></tr></table></div>';
    expect(parseHoldingsSection(reordered).rows).toEqual([{
      Name: 'Cameco Corp.', Ticker: 'CCJ', Identifier: '2158684', Weight: '99.85', 'Market Value': '376658199.63', 'Shares Held': '4345889', SEDOL: '2158684',
    }]);
    expect(() => parseHoldingsSection(reordered.replace('<th>Weight</th>', '<th>Wt</th>'))).toThrow('no Weight column');
    const csv = (header: string) => `<a href="data:application/csv;charset=utf-8,${encodeURIComponent(`${header}\nCameco Corp.,CCJ,99.85`)}">Download</a>`;
    expect(parseHoldingsSection(csv('Security,Symbol,Weight')).rows[0]).toMatchObject({ Name: 'Cameco Corp.', Ticker: 'CCJ', Weight: '99.85' });
    expect(() => parseHoldingsSection(csv('Holding,Symbol,Weight'))).toThrow('no Security column');
  });

  test('dates: month-name and U.S. dates are the same calendar day in every time zone', () => {
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz;
      expect(['Oct 24, 2026', 'October 24 2026', '24 Oct 2026', '10/24/2026', '10/24/26', '2026-10-24', '2026-10-24T00:00:00Z'].map((raw) => toIsoDate(raw))).toEqual(Array(7).fill('2026-10-24'));
      expect([isoDate('Oct 24 2026'), isoDate('10/24/2026 4:00 PM'), storedDateIso('Sept. 30, 2026'), parseLongDate('As of October 24, 2026')]).toEqual(['2026-10-24', '2026-10-24', '2026-09-30', '2026-10-24']);
      expect([toIsoDate('not a date'), isoDate('02/30/2026'), parseLongDate('Smarch 3, 2026')]).toEqual(['not a date', null, null]);
    }
  });
});

describe('metrics', () => {
  const days = [
    { date: '2025-12-31', close: 10, adjClose: 10, volume: 1 },
    { date: '2026-09-29', close: 11, adjClose: 11, volume: 1 },
    { date: '2026-09-30', close: 12, adjClose: 12, volume: 1 },
  ];
  const derived = priceReturns(days, new Date('2026-09-30T00:00:00Z'));
  const month = { asOfDate: 'Aug 31 2026', ytd: 5, yr1: 9, yr3: 3, yr5: null, yr10: null, sinceInception: 2 };

  test('a young fund gets null (never 0) for horizons it is too young for', () => {
    expect(derived.ytd).toBe(20);
    expect([derived.yr1, derived.cagr3y, derived.cagr5y, derived.cagr10y, derived.siAnn]).toEqual([null, null, null, null, null]);
    expect(priceReturns([])).toMatchObject({ asOfDate: '', ytd: null, yr1: null, cagr10y: null });
    const metrics = buildMetrics(null, derived, null, null, 'basis', '2026-09-30');
    expect([metrics.tr3y, metrics.tr5y, metrics.tr10y, metrics.cagr3y, metrics.secYield, metrics.dividendYield]).toEqual([null, null, null, null, null, null]);
  });

  test('metrics end with returnsBasis then performanceAsOf, which travel together', () => {
    const metrics = buildMetrics(month, derived, null, 1.5, 'official test basis', '2026-08-31');
    expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    expect([metrics.returnsBasis, metrics.performanceAsOf, metrics.ytd]).toEqual(['official test basis', '2026-08-31', 5]);
    expect(Object.keys(buildMetrics(null, derived, null, null, 'x', null))).toEqual(Object.keys(metrics));
  });

  test('dividendYieldBasis is indicated for every yield and null exactly when the yield is null', () => {
    expect([dividendYieldBasis(1.5), dividendYieldBasis(0), dividendYieldBasis(null), dividendYieldBasis(undefined), dividendYieldBasis(NaN)])
      .toEqual(['indicated', 'indicated', null, null, null]);
    const withYield = buildMetrics(month, derived, null, 1.5, 'x', null);
    const noYield = buildMetrics(null, derived, null, null, 'x', null);
    expect([withYield.dividendYieldBasis, noYield.dividendYieldBasis]).toEqual(['indicated', null]);
    expect(Object.keys(noYield)).toEqual(Object.keys(withYield));
  });

  test('rows kept from an older index get the code of their own yield and the same key set', () => {
    const fresh = buildMetrics(month, derived, null, 2.5, 'x', '2026-08-31');
    const old = (dividendYield: number | null) => ({ ticker: 'T', metrics: { ytd: 1, dividendYield, dividendYieldText: '-', returnsBasis: 'b', performanceAsOf: null } });
    const kept = withYieldBasis(old(4.2)).metrics;
    const none = withYieldBasis(old(null)).metrics;
    expect([kept.dividendYieldBasis, none.dividendYieldBasis]).toEqual(['indicated', null]);
    expect(Object.keys(kept)).toEqual(['ytd', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'returnsBasis', 'performanceAsOf']);
    expect(withYieldBasis({ ticker: 'T', metrics: fresh }).metrics).toEqual(fresh);
    expect(withYieldBasis({ ticker: 'T' }).metrics.dividendYieldBasis).toBeNull();
  });

  test('performanceAsOf is the official table date, else the last Yahoo close, else null - never the NAV date', () => {
    expect(performanceAsOfDate(true, month, derived)).toBe('2026-08-31');
    expect(performanceAsOfDate(false, month, derived)).toBe('2026-09-30');
    expect(performanceAsOfDate(true, null, priceReturns([]))).toBeNull();
    expect([storedDateIso('Sep 30 2026'), storedDateIso('Sep 30, 2026'), storedDateIso('2026-09-30'), storedDateIso('—'), storedDateIso(undefined)])
      .toEqual(['2026-09-30', '2026-09-30', '2026-09-30', null, null]);
  });
});

describe('metrics 2', () => {
  test('a fund younger than its horizon publishes no 1y, 3y, 5y or since-inception return, official or derived (calendar anniversary, inclusive)', async () => {
    const box = sandbox();
    const good = globalThis.fetch;
    // URNM started this year, SETM exactly one year before the 9/30/2026 month-end table, COPJ in 2019
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/urnm-sprott-etf/')) return new Response(pageHtml({ ticker: 'URNM' }).replace('December 3, 2019', 'January 15, 2026'));
      if (url.endsWith('/setm-sprott-etf/')) return new Response(pageHtml({ ticker: 'SETM' }).replace('December 3, 2019', 'September 30, 2025'));
      return good(url);
    }) as unknown as typeof fetch;
    await box.run();
    const row = (ticker: string) => JSON.parse(box.read('index.json')).funds.find((fund: any) => fund.ticker === ticker);
    const young = row('URNM').metrics;
    expect([young.ytd, young.tr1y, young.cagr3y, young.tr3y, young.cagr5y, young.tr5y, young.siAnn, young.performanceAsOf]).toEqual([-13.32, null, null, null, null, null, null, '2026-09-30']);
    const meta = JSON.parse(box.read('funds/URNM/meta.json'));
    expect(meta.returns.monthEnd).toMatchObject({ ytd: -13.32, yr1: null, yr3: null, yr5: null, sinceInception: null });
    expect(meta.returns.quarterEnd).toMatchObject({ yr1: null, sinceInception: null });
    // one year old on its first anniversary: 1y and since inception, still no 3y or 5y
    const year = row('SETM').metrics;
    expect([year.tr1y, year.siAnn, year.cagr3y, year.cagr5y]).toEqual([-18.52, 25.01, null, null]);
    expect(row('COPJ').metrics).toMatchObject({ tr1y: -18.52, cagr3y: 3.44, cagr5y: 8.01, siAnn: 25.01 });
  });

  test('retained returns travel with their performanceAsOf and basis and never touch the yield', () => {
    const fresh = { ytd: 1, tr1y: 2, tr3y: null, dividendYield: null, returnsBasis: 'new basis', performanceAsOf: '2026-09-30' };
    const previous = { ytd: 5, tr1y: 6, tr3y: 7.5, dividendYield: 4.2, returnsBasis: 'old basis', performanceAsOf: '2026-06-30' };
    const kept = { ...fresh, ...retainReturns(fresh, previous) };
    expect<unknown[]>([kept.tr3y, kept.performanceAsOf, kept.returnsBasis, kept.dividendYield]).toEqual([7.5, '2026-06-30', 'old basis', null]);
    expect([retainReturns(fresh, undefined), retainReturns(fresh, {})]).toEqual([{}, {}]);
  });

  test('conversions round to two decimals, yield and frequency inference stay null without evidence', () => {
    expect([annualizedToTotal(3.44, 3), annualizedToTotal(null, 3), totalToAnnualized(10.68, 3)]).toEqual([10.68, null, 3.44]);
    expect([indicatedYield(1.74, 1, 47.5), indicatedYield(0, 1, 47.5), indicatedYield(1.74, null, 47.5), indicatedYield(1.74, 1, 0)]).toEqual([3.66, null, null, null]);
    const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
    const pay = (...dates: string[]) => dates.map((date) => ({ epoch: at(date), amount: 0.1 }));
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    expect(inferDistributionFrequency(pay('2025-12-18'))).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency(pay('2023-12-14', '2024-12-12', '2025-12-18'))).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
    expect(inferDistributionFrequency(pay('2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(pay('2025-06-30', '2025-12-31'))).toEqual({ frequency: 'Semi-annually', paymentsPerYear: 2 });
  });
});

describe('metrics 3', () => {
  test('month-end anchor is UTC midnight in any timezone', () => {
    for (const tz of ['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(monthAnchor({ asOfDate: 'Sep 30 2026' }, [])?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    }
    expect(monthAnchor(null, [{ date: '2026-08-31' }] as any)?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(monthAnchor(null, [])).toBeNull();
  });

  test('published history dates are calendar dates: the same rows and dates in every timezone', () => {
    const previous = [{ Date: 'Oct 01 2026', Close: '10', 'Adj Close': '10', Volume: '1' }];
    const fresh = [{ date: '2026-10-01', close: 10, adjClose: 10, volume: 1 }, { date: '2026-10-02', close: 11, adjClose: 11, volume: 1 }];
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Berlin']) {
      process.env.TZ = tz;
      const merged = mergeHistory(previous, fresh);
      expect(merged.map((row) => row.Date)).toEqual(['Oct 01 2026', 'Oct 02 2026']);
      expect(chartDaysFromRows(merged).map((day) => day.date)).toEqual(['2026-10-01', '2026-10-02']);
    }
  });

  test('history merge: a published adjusted close keeps its cent within float noise only, a real change of one cent replaces it', () => {
    const day = (date: string, adjCloseRaw: number) => ({ date, close: 36.540001, adjClose: Math.round(adjCloseRaw * 100) / 100, volume: 9000, adjCloseRaw });
    const previous = [{ Date: 'Oct 10 2016', Close: '36.540001', 'Adj Close': '27.69', Volume: '9000' }];
    expect(ADJ_CLOSE_NOISE).toBe(1e-4);
    expect([27.695001, 27.6952, 27.7, 27.85].map((raw) => mergeHistory(previous, [day('2016-10-10', raw)])[0]['Adj Close'])).toEqual(['27.69', '27.7', '27.7', '27.85']);
    expect(mergeHistory([], [day('2016-10-10', 27.7), day('2016-10-11', 27.9)]).map((row) => row.Date)).toEqual(['Oct 10 2016', 'Oct 11 2016']);
  });
});

// ===========================================================================
// Sandbox: the real script is copied into a temp dir so main() writes under <tmp>/api/sprott
// ===========================================================================
const FUNDS = ['COPJ', 'SETM', 'URNM'];
const ts = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000;
const chartPayload = {
  chart: { result: [{
    meta: { regularMarketPrice: 47.5, regularMarketTime: ts('2026-09-30'), firstTradeDate: ts('2026-09-01'), fullExchangeName: 'NYSE Arca', longName: 'Sprott ETF' },
    timestamp: [ts('2026-09-28'), ts('2026-09-29'), ts('2026-09-30')],
    indicators: { quote: [{ close: [47, 47.2, 47.5], volume: [100, 200, 300] }], adjclose: [{ adjclose: [47, 47.2, 47.5] }] },
  }] },
};
const sitemapXml = FUNDS.map((ticker) => `<url><loc>https://sprottetfs.com/${ticker.toLowerCase()}-sprott-etf/</loc></url>`).join('');
const navHtml = FUNDS.map((ticker) => `<a href="/${ticker.toLowerCase()}-sprott-etf" title="Sprott ${ticker} ETF" class=" phv-btn purple-bg large">${ticker}</a>`).join('');

type Router = (url: string) => Response | undefined;
function sandbox(router: Router = () => undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'sprott-test-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'api', 'sprott'), { recursive: true });
  for (const name of ['update-data.ts', 'update-data.config.json']) copyFileSync(join(scriptsDir, name), join(dir, 'scripts', name));
  const api = join(dir, 'api', 'sprott');
  const urls: string[] = [];
  let down = new Set<string>();
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if ([...down].some((part) => url.includes(part))) return new Response('gone', { status: 404 });
    if (url.endsWith('/sitemap.xml')) return new Response(sitemapXml);
    const slug = /sprottetfs\.com\/([a-z]+)-sprott-etf\/?$/.exec(url);
    if (slug) return new Response(url.endsWith('/') ? pageHtml({ ticker: slug[1].toUpperCase() }) : navHtml);
    if (url.includes('/v8/finance/chart/')) return new Response(JSON.stringify(chartPayload));
    return router(url) ?? new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const logs: string[] = [];
  const run = async (env: Record<string, string> = {}): Promise<void> => {
    const mod = await import(join(dir, 'scripts', 'update-data.ts'));
    console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    await mod.main({ REQUEST_SLEEP: '0', CONCURRENCY: '1', MAX_RETRIES: '1', EDGAR_FALLBACK: 'false', USE_SYSTEM_CA: 'false', ...env });
    Object.assign(console, realConsole);
  };
  const read = (path: string): string => readFileSync(join(api, path), 'utf8');
  const files = (): string[] => {
    const walk = (folder: string): string[] => readdirSync(join(api, folder), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => (entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]));
    return walk('');
  };
  const backdate = (): void => { for (const path of files()) utimesSync(join(api, path), 1_000_000_000, 1_000_000_000); };
  const touched = (): string[] => files().filter((path) => statSync(join(api, path)).mtimeMs !== 1_000_000_000_000);
  // the module main() runs in (its own copy, so CLOSED_FUNDS of this sandbox is reached here, not through the test's import)
  const module = (): Promise<any> => import(join(dir, 'scripts', 'update-data.ts'));
  return { api, urls, logs, run, read, files, backdate, touched, module, setDown: (...parts: string[]) => { down = new Set(parts); } };
}

describe('pipeline', () => {
  test('a first run publishes every fund with the same metrics key set, null (never 0) for unknown horizons', async () => {
    const box = sandbox();
    await box.run();
    const index = JSON.parse(box.read('index.json'));
    expect(index.funds.map((row: any) => row.ticker)).toEqual(FUNDS);
    expect(index.counts.funds).toBe(3);
    const keys = Object.keys(index.funds[0].metrics).sort();
    for (const row of index.funds) {
      expect(Object.keys(row.metrics).sort()).toEqual(keys);
      // the 52-week range keys from the published history pages (shared range-52w block)
      expect(Object.keys(row.metrics)).toEqual(expect.arrayContaining(['week52Low', 'week52High', 'range52w', 'range52wClose', 'range52wAsOf', 'range52wSince', 'range52wBasis']));
      expect(row.metrics.cagr10y).toBeNull();
      expect(row.metrics.returnsBasis).toBeTruthy();
      expect(row.metrics.dividendYieldBasis).toBe(row.metrics.dividendYield === null ? null : 'indicated');
      expect(row.metrics.performanceAsOf).toBe('2026-09-30');
      expect(row.dataFile).toBe(`./funds/${row.ticker}/meta.json`);
    }
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('a one-ticker run keeps every row and every published file', async () => {
    const box = sandbox();
    await box.run();
    const before = box.files();
    await box.run({ TICKERS: 'URNM' });
    expect(JSON.parse(box.read('index.json')).funds.map((row: any) => row.ticker)).toEqual(FUNDS);
    const after = box.files();
    for (const path of before) expect(after).toContain(path);
  });

  test('a second identical run writes nothing', async () => {
    const box = sandbox();
    await box.run();
    box.backdate();
    const before = Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    await box.run();
    expect(box.touched()).toEqual([]);
    expect(Object.fromEntries(box.files().map((path) => [path, box.read(path)]))).toEqual(before);
  });

  test('two runs on the same source data write zero changes even when Yahoo adjusted closes jitter across a cent boundary', async () => {
    // Yahoo float32 noise seen live: SPDV 2024-11-12 came back as 31.544998 and 31.545001 a minute apart
    const adjusted = chartPayload.chart.result[0].indicators.adjclose[0];
    const original = adjusted.adjclose;
    try {
      const box = sandbox();
      adjusted.adjclose = [47.005001, 47.194999, 47.5];
      await box.run();
      box.backdate();
      const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
      const before = snapshot();
      adjusted.adjclose = [47.004998, 47.195002, 47.5];
      await box.run();
      expect(box.touched()).toEqual([]);
      expect(snapshot()).toEqual(before);
      // a real change of one cent is still written
      adjusted.adjclose = [47.02, 47.18, 47.5];
      await box.run();
      expect(snapshot()).not.toEqual(before);
      expect(JSON.parse(box.read('funds/URNM/history/001.json')).rows.map((row: Record<string, string>) => row['Adj Close'])).toEqual(['47.02', '47.18', '47.5']);
    } finally {
      adjusted.adjclose = original;
    }
  });
});

describe('pipeline 2', () => {
  test('a failed fund page or Yahoo chart keeps the published fund byte for byte and reports it failed', async () => {
    const box = sandbox();
    await box.run();
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const before = snapshot();
    // the page fails while Yahoo answers with a newer close: no fresh price, history or yield next to the old NAV
    const newer = { ...chartPayload.chart.result[0], timestamp: [...chartPayload.chart.result[0].timestamp, ts('2026-10-01')],
      indicators: { quote: [{ close: [47, 47.2, 47.5, 49], volume: [100, 200, 300, 400] }], adjclose: [{ adjclose: [47, 47.2, 47.5, 49] }] } };
    const good = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => (String(input).includes('/chart/URNM')
      ? new Response(JSON.stringify({ chart: { result: [newer] } }))
      : good(String(input)))) as unknown as typeof fetch;
    box.setDown('/urnm-sprott-etf/');
    await box.run({ TICKERS: 'URNM' });
    expect(snapshot()).toEqual(before);
    expect(process.exitCode).toBe(1);
    // the page answers and Yahoo fails: kept whole as well
    process.exitCode = 0;
    globalThis.fetch = good;
    box.setDown('/chart/URNM');
    await box.run({ TICKERS: 'URNM' });
    expect(snapshot()).toEqual(before);
    expect(process.exitCode).toBe(1);
  });

  test('fresh holdings that fail the guard keep the fund exactly as published and report it failed', async () => {
    const box = sandbox();
    await box.run();
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const before = snapshot();
    const good = globalThis.fetch;
    // the page CSV publishes a broken weight (9.85 instead of 99.85): the weights add up to 10
    globalThis.fetch = (async (input: unknown) => (String(input).endsWith('/urnm-sprott-etf/')
      ? new Response(pageHtml({ ticker: 'URNM' }).replace('%2C99.85%2C', '%2C9.85%2C'))
      : good(String(input)))) as unknown as typeof fetch;
    await box.run({ TICKERS: 'URNM' });
    expect(snapshot()).toEqual(before);
    expect(process.exitCode).toBe(1);
  });

  test('a closed fund is never fetched or reported failed: its files stay as published, its index row says closed, a rerun writes nothing', async () => {
    const entry = { ticker: 'URNM', closed: '2026-10-01', source: 'https://www.sec.gov/Archives/edgar/data/1728683/notice.htm' };
    expect(() => closedFund([{ ...entry, closed: 'soon' }], 'URNM')).toThrow('CLOSED_FUNDS');
    expect(closedFund([entry], 'urnm')).toEqual(entry);
    const box = sandbox();
    await box.run();
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const first = snapshot();
    const firstRow = JSON.parse(box.read('index.json')).funds.find((row: any) => row.ticker === 'URNM');
    const good = globalThis.fetch, calls: string[] = [];
    let listed = true;
    // the COPJ page carries the fund list (so the catalog reads no other page), URNM's holdings would fail the guard
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/sitemap.xml') && !listed) return new Response(sitemapXml.replace(/<url><loc>[^<]*urnm[^<]*<\/loc><\/url>/, ''));
      if (url.endsWith('/copj-sprott-etf/')) return new Response(navHtml);
      if (url.endsWith('/urnm-sprott-etf/')) return new Response(pageHtml({ ticker: 'URNM' }).replace('Weight%2CMarket', 'Wt%2CMarket'));
      return good(url);
    }) as unknown as typeof fetch;
    const { CLOSED_FUNDS } = await box.module();
    CLOSED_FUNDS.push(entry);
    try {
      await box.run({ TICKERS: 'URNM' });
      expect(calls.filter((url) => /urnm/i.test(url))).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      const closed = snapshot();
      for (const path of Object.keys(first)) if (path !== 'index.json') expect([path, closed[path]]).toEqual([path, first[path]]);
      const rows = JSON.parse(box.read('index.json')).funds;
      expect(rows.map((row: any) => row.ticker)).toEqual(FUNDS);
      const { status, closedDate, closedSource, ...rest } = rows.find((row: any) => row.ticker === 'URNM');
      expect([status, closedDate, closedSource]).toEqual(['closed', '2026-10-01', entry.source]);
      expect(rest).toEqual(firstRow);
      expect(rows.filter((row: any) => row.status === 'closed')).toHaveLength(1);
      const recording = globalThis.fetch;
      globalThis.fetch = good;
      await box.run();
      expect(snapshot()).toEqual(closed);
      // the live catalog drops the closed fund: TICKERS still accepts it, its row and files survive unchanged
      globalThis.fetch = recording;
      listed = false;
      await box.run({ TICKERS: 'URNM' });
      expect(process.exitCode).not.toBe(1);
      expect(snapshot()).toEqual(closed);
    } finally {
      CLOSED_FUNDS.splice(CLOSED_FUNDS.indexOf(entry), 1);
    }
  });

  test('a new fund whose holdings fail the guard is failed and still gets a catalog-only row (dataFile null, full metrics key set) and no files', async () => {
    const box = sandbox();
    const good = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => (String(input).endsWith('/urnm-sprott-etf/')
      ? new Response(pageHtml({ ticker: 'URNM' }).replace('%2C99.85%2C', '%2C9.85%2C'))
      : good(String(input)))) as unknown as typeof fetch;
    await box.run();
    expect(process.exitCode).toBe(1);
    const rows = JSON.parse(box.read('index.json')).funds;
    expect(rows.map((row: any) => row.ticker)).toEqual(FUNDS);
    const row = rows.find((fund: any) => fund.ticker === 'URNM');
    expect(row).toMatchObject({ dataFile: null, holdings: 0, history: 0, fundPage: 'https://sprottetfs.com/urnm-sprott-etf/' });
    expect(Object.keys(row.metrics)).toEqual(Object.keys(rows[0].metrics));
    expect([row.metrics.tr1y, row.metrics.dividendYield, row.metrics.performanceAsOf]).toEqual([null, null, null]);
    expect(row.metrics.returnsBasis).toBeTruthy();
    expect(box.files().filter((path) => path.startsWith('funds/URNM/'))).toEqual([]);
  });
});

describe('pipeline 3', () => {
  test('a new fund that no source answered is failed with a catalog-only row, and that row is never read as published data on the next run', async () => {
    const box = sandbox();
    box.setDown('/urnm-sprott-etf', '/chart/URNM');
    await box.run();
    expect(process.exitCode).toBe(1);
    expect(box.files().filter((path) => path.startsWith('funds/URNM/'))).toEqual([]);
    expect(JSON.parse(box.read('index.json')).funds.find((row: any) => row.ticker === 'URNM')).toMatchObject({ dataFile: null, holdings: 0 });
    // next run: the page answers without a performance table and Yahoo is still down, so no returns are known yet
    process.exitCode = 0;
    box.setDown('/chart/URNM');
    const good = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => (String(input).endsWith('/urnm-sprott-etf/')
      ? new Response(pageHtml({ ticker: 'URNM' }).replace(/(Month|Quarter)-End Performance/g, 'Performance'))
      : good(String(input)))) as unknown as typeof fetch;
    await box.run({ TICKERS: 'URNM' });
    expect(process.exitCode ?? 0).toBe(0);
    const row = JSON.parse(box.read('index.json')).funds.find((fund: any) => fund.ticker === 'URNM');
    expect(row.dataFile).toBe('./funds/URNM/meta.json');
    expect([row.metrics.returnsBasis, row.metrics.performanceAsOf]).toEqual(['Yahoo adjusted market-price returns, not official NAV', null]);
  });

  test('a failed fund page keeps the fund whole; with SKIP_SPROTT an older N-PORT keeps the fresher holdings, a newer one replaces them', async () => {
    let repPdDate = '2026-06-30';
    const nport = () => `<edgarSubmission><formData><genInfo><regName>SPROTT FUNDS TRUST</regName><regCik>0001728683</regCik>
      <seriesName>Sprott Uranium Miners ETF</seriesName><seriesId>S000068011</seriesId><repPdDate>${repPdDate}</repPdDate></genInfo>
      <invstOrSecs><invstOrSec><name>Cameco Corp.</name><pctVal>60</pctVal><valUSD>600</valUSD><balance>6</balance></invstOrSec>
      <invstOrSec><name>NexGen Energy Ltd.</name><pctVal>40</pctVal><valUSD>400</valUSD><balance>4</balance></invstOrSec></invstOrSecs></formData></edgarSubmission>`;
    const box = sandbox((url) => {
      if (url.endsWith('/company_tickers_mf.json')) return new Response(JSON.stringify({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1728683, 'S000068011', 'C000220000', 'URNM']] }));
      if (url.includes('/submissions/CIK0001728683.json')) return new Response(JSON.stringify({ cik: '1728683', filings: { recent: { form: ['NPORT-P'], accessionNumber: ['0001728683-26-000001'], filingDate: ['2026-08-28'], reportDate: ['2026-06-30'] } } }));
      if (url.endsWith('/primary_doc.xml')) return new Response(nport());
      return undefined;
    });
    await box.run({ EDGAR_FALLBACK: 'true' });
    const holdings = box.read('funds/URNM/holdings/001.json');
    const meta = box.read('funds/URNM/meta.json');
    box.setDown('/urnm-sprott-etf/');
    await box.run({ EDGAR_FALLBACK: 'true', TICKERS: 'URNM' });
    expect([box.read('funds/URNM/holdings/001.json'), box.read('funds/URNM/meta.json')]).toEqual([holdings, meta]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    await box.run({ EDGAR_FALLBACK: 'true', TICKERS: 'URNM', SKIP_SPROTT: 'true' });
    expect(box.read('funds/URNM/holdings/001.json')).toBe(holdings);
    expect(JSON.parse(box.read('funds/URNM/meta.json')).holdings).toMatchObject({ asOfDate: '2026-09-30', totalRows: 2 });
    expect(box.urls.some((url) => url.endsWith('/primary_doc.xml'))).toBe(true);
    repPdDate = '2026-10-31';
    await box.run({ EDGAR_FALLBACK: 'true', TICKERS: 'URNM', SKIP_SPROTT: 'true' });
    expect(JSON.parse(box.read('funds/URNM/meta.json')).holdings).toMatchObject({ asOfDate: '2026-10-31', source: expect.stringContaining('primary_doc.xml') });
    const sheet = JSON.parse(box.read('funds/URNM/holdings/001.json'));
    expect(sheet.headers).toEqual(HOLDINGS_HEADERS);
    expect(sheet.rows).toEqual([
      { Name: 'Cameco Corp.', Ticker: '-', Identifier: '-', Weight: '60', 'Market Value': '600', 'Shares Held': '6', SEDOL: '-' },
      { Name: 'NexGen Energy Ltd.', Ticker: '-', Identifier: '-', Weight: '40', 'Market Value': '400', 'Shares Held': '4', SEDOL: '-' },
    ]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('a new fund whose page fails while Yahoo answers is failed with a catalog-only row, never an empty updated fund', async () => {
    const box = sandbox();
    box.setDown('/urnm-sprott-etf/');
    await box.run();
    expect(process.exitCode).toBe(1);
    expect(box.files().filter((path) => path.startsWith('funds/URNM/'))).toEqual([]);
    expect(JSON.parse(box.read('index.json')).funds.find((row: any) => row.ticker === 'URNM')).toMatchObject({ dataFile: null, holdings: 0, history: 0 });
  });

  test('a dead catalog falls back to the published funds instead of shrinking the index', async () => {
    const box = sandbox();
    await box.run();
    box.setDown('sprottetfs.com', 'finance');
    await box.run();
    expect(JSON.parse(box.read('index.json')).funds.map((row: any) => row.ticker)).toEqual(FUNDS);
  });

  test('index stamps are ignored when comparing, and written without milliseconds', () => {
    const body = { counts: { funds: 1 }, funds: [{ ticker: 'URNM' }] };
    const old = { generatedAt: '2026-01-01T00:00:00Z', catalogReadAt: '2026-01-01T00:00:00Z', ...body };
    expect(samePublishedContent(JSON.stringify(withoutStamps(old)), body)).toBe(true);
    expect(samePublishedContent(JSON.stringify(withoutStamps(old)), { ...body, counts: { funds: 2 } })).toBe(false);
  });
});

describe('pipeline 4', () => {
  test('a HISTORY_RANGE window keeps the older history: zero diff on the same data, older rows rescaled to a re-adjusted window, a window that does not join keeps the fund (Q25)', async () => {
    const box = sandbox();
    await box.run();
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const first = snapshot();
    const good = globalThis.fetch;
    const windowed = (adjFactor: number, closeFactor: number): void => {
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (!url.includes('/v8/finance/chart/')) return good(url);
        const result = JSON.parse(JSON.stringify(chartPayload.chart.result[0]));
        result.timestamp = result.timestamp.slice(-2);
        result.indicators.quote[0].close = result.indicators.quote[0].close.slice(-2).map((value: number) => value * closeFactor);
        result.indicators.quote[0].volume = result.indicators.quote[0].volume.slice(-2);
        result.indicators.adjclose[0].adjclose = result.indicators.adjclose[0].adjclose.slice(-2).map((value: number) => value * adjFactor);
        return new Response(JSON.stringify({ chart: { result: [result] } }));
      }) as unknown as typeof fetch;
    };
    windowed(1, 1);
    await box.run({ TICKERS: 'URNM', HISTORY_RANGE: '1y' });
    expect(snapshot()).toEqual(first);
    // the closes did not join (doubled): the fund is kept exactly as published and reported failed
    windowed(1, 2);
    await box.run({ TICKERS: 'URNM', HISTORY_RANGE: '1y' });
    expect(snapshot()).toEqual(first);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    // Yahoo re-adjusted the whole series after a distribution: the older published row follows the window, none is lost
    windowed(0.98, 1);
    await box.run({ TICKERS: 'URNM', HISTORY_RANGE: '1y' });
    const history = JSON.parse(box.read('funds/URNM/history/001.json'));
    expect(history.rows.map((row: Record<string, string>) => [row.Date, row['Adj Close']])).toEqual([['Sep 28 2026', '46.06'], ['Sep 29 2026', '46.26'], ['Sep 30 2026', '46.55']]);
    expect(JSON.parse(box.read('funds/URNM/meta.json')).history.totalRows).toBe(3);
    // a truncated `max` answer (Yahoo served 2 bars for some funds on 2026-10-29) never shrinks the history either:
    // one that joins the published days keeps them all, one that does not join keeps the fund as published
    const joined = snapshot();
    windowed(0.98, 1);
    await box.run({ TICKERS: 'URNM' });
    expect(snapshot()).toEqual(joined);
    windowed(1, 2);
    await box.run({ TICKERS: 'URNM' });
    expect(snapshot()).toEqual(joined);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('a relaxed guard still keeps numeric published weights from an all-dash sheet (Q24)', async () => {
    const box = sandbox();
    await box.run();
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const first = snapshot();
    const good = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => (String(input).endsWith('/urnm-sprott-etf/')
      ? new Response(pageHtml({ ticker: 'URNM' }).replace('%2C99.85%2C', '%2C-%2C').replace('%2C0.15%2C', '%2C-%2C'))
      : good(String(input)))) as unknown as typeof fetch;
    const { HOLDINGS_GUARD_RELAX } = await box.module();
    HOLDINGS_GUARD_RELAX.URNM = ['numeric', 'sum'];
    try {
      await box.run({ TICKERS: 'URNM' });
    } finally {
      delete HOLDINGS_GUARD_RELAX.URNM;
    }
    expect(snapshot()).toEqual(first);
    expect(process.exitCode).toBe(1);
    expect(box.logs.some((line) => line.includes('no row has a numeric weight, the published sheet had 2'))).toBe(true);
    expect(holdingsWeightCount(['Name', 'Weight'], [['A', '-'], ['B', '2']])).toBe(1);
  });
});

describe('pipeline 5', () => {
  test('TICKERS outside the live catalog and the published feed stops the run before any fund request; a stale catalog-only row is dropped (Q27)', async () => {
    const box = sandbox();
    await box.run();
    const index = JSON.parse(box.read('index.json'));
    index.funds.push(catalogOnlyRow({ ticker: 'NOPE', name: 'NOPE', fundPage: 'https://sprottetfs.com/nope-etf/', assetClass: '', isin: '', nav: null, navDate: null }));
    writeFileSync(join(box.api, 'index.json'), JSON.stringify(index));
    const snapshot = () => Object.fromEntries(box.files().map((path) => [path, box.read(path)]));
    const before = snapshot();
    box.urls.length = 0;
    await expect(box.run({ TICKERS: 'URNM NOPE' })).rejects.toThrow('TICKERS: NOPE not in the Sprott catalog or published feed; nothing was fetched or written');
    // only the catalog was read (the sitemap and up to three fund pages for the fund list): no chart, SEC or holdings request
    expect(box.urls.filter((url) => !url.startsWith('https://sprottetfs.com/'))).toEqual([]);
    expect(box.urls.length).toBeLessThanOrEqual(4);
    expect(snapshot()).toEqual(before);
    await box.run({ TICKERS: 'URNM' });
    expect(JSON.parse(box.read('index.json')).funds.map((row: any) => row.ticker)).toEqual(FUNDS);
  });

  test('NEW FUNDS announces a fund on its first successful publish, a failed new fund as not published yet (Q28)', async () => {
    const box = sandbox();
    await box.run();
    // URNM was a catalog-only row before (its first read failed), SETM is new in the catalog and its page fails now
    const index = JSON.parse(box.read('index.json'));
    const urnm = index.funds.find((row: any) => row.ticker === 'URNM');
    index.funds = index.funds.filter((row: any) => row.ticker === 'COPJ').concat(catalogOnlyRow({ ticker: 'URNM', name: urnm.name, fundPage: urnm.fundPage, assetClass: '', isin: '', nav: null, navDate: null }));
    writeFileSync(join(box.api, 'index.json'), JSON.stringify(index));
    for (const ticker of ['SETM', 'URNM']) rmSync(join(box.api, 'funds', ticker), { recursive: true, force: true });
    box.setDown('/setm-sprott-etf/');
    const summary = join(box.api, '..', 'summary.md');
    const newFunds = (): string[] => box.logs.splice(0).filter((line) => /^NEW FUNDS/.test(line));
    box.logs.length = 0;
    await box.run({ GITHUB_STEP_SUMMARY: summary });
    expect(newFunds()).toEqual(['NEW FUNDS: URNM', 'NEW FUNDS (not published yet): SETM']);
    expect(readFileSync(summary, 'utf8')).toContain('### NEW FUNDS\n\nNEW FUNDS: URNM\nNEW FUNDS (not published yet): SETM\n');
    process.exitCode = 0;
    await box.run();
    expect(newFunds()).toEqual([]);
    process.exitCode = 0;
    box.setDown();
    await box.run();
    expect(newFunds()).toEqual(['NEW FUNDS: SETM']);
  });
});

// ===========================================================================
describe('network', () => {
  test('the timeout signal covers the body: a body that fails is retried', async () => {
    expect(FETCH_TIMEOUT_MS).toBe(45_000);
    let calls = 0, signal: AbortSignal | null | undefined;
    configureRequestPacing(1, 0);
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal; calls++;
      if (calls === 1) return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), arrayBuffer: async () => { throw new Error('body timeout'); } };
      return new Response('ok');
    }) as any;
    const response = await fetchWithRetry('https://example.test/x', 'x', {}, 1);
    expect(await response.text()).toBe('ok');
    expect(calls).toBe(2);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('retries are bounded by MAX_RETRIES and a non-retryable status is not retried', async () => {
    configureRequestPacing(1, 0);
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('x', { status: 503 }); }) as unknown as typeof fetch;
    await expect(fetchWithRetry('https://example.test/x', 'x', {}, 2)).rejects.toThrow();
    expect(calls).toBe(3);
    calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('x', { status: 404 }); }) as unknown as typeof fetch;
    await expect(fetchWithRetry('https://example.test/x', 'x', {}, 2)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('in-flight peak is 1 at CONCURRENCY=1 and N at CONCURRENCY=N with REQUEST_SLEEP > 0', async () => {
    const peakFetches = async (concurrency: number, items = 9): Promise<number> => {
      let inFlight = 0, peak = 0;
      globalThis.fetch = (async () => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => realSetTimeout(resolve, 40));
        inFlight--;
        return new Response('ok');
      }) as unknown as typeof fetch;
      configureRequestPacing(concurrency, 10);
      await runPool(Array.from({ length: items }, (_, i) => i), concurrency, async (i) => {
        await fetchWithRetry(`https://example.test/${i}`, 'test', {}, 1);
      });
      return peak;
    };
    expect(await peakFetches(1)).toBe(1);
    expect(await peakFetches(3)).toBe(3);
    expect(await peakFetches(15, 30)).toBe(15);
  });

  test('request lanes pace independently: N callers start together, the next round waits one sleep', async () => {
    let clock = 0;
    const waits: number[] = [];
    const gate = createRequestGate(3, 1000, () => clock, async (ms) => { waits.push(ms); clock += ms; });
    for (let i = 0; i < 3; i++) await gate();
    expect(waits).toEqual([]);
    await gate();
    expect(waits).toEqual([1000]);
  });

  test('HISTORY_RANGE reaches the Yahoo request as explicit period1/period2', async () => {
    const chartUrl = async (range: string): Promise<URL> => {
      const box = sandbox();
      await box.run({ TICKERS: 'URNM', HISTORY_RANGE: range });
      return new URL(box.urls.find((url) => url.includes('/chart/URNM'))!);
    };
    const max = await chartUrl('max');
    expect(max.searchParams.get('period1')).toBe('0');
    expect(max.searchParams.has('range')).toBe(false);
    const limited = await chartUrl('5y');
    const [p1, p2] = [Number(limited.searchParams.get('period1')), Number(limited.searchParams.get('period2'))];
    expect(p1).toBeGreaterThan(0);
    expect(Math.round((p2 - p1) / 86_400 / 365.25)).toBe(5);
  });
});
