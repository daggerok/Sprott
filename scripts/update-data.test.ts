/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  CONTROL_NAMES, annualizedToTotal, batchSelection, cellsIn, decodeEntities, formatEdgarDate,
  formatUsDate, indicatedYield, inferDistributionFrequency, isoDate, mergeHistory, normalizeNumberText, numberOrNull,
  parseCatalogNav, parseFeesTable, parseFundPage, parseHoldingsSection, parseLongDate, parseMoneyText,
  parseNport, parsePercentText, parseSitemapFundPages, parseSprottPerformance, parseReturnTable,
  parseDistributionsSection, resolveControls, readConfig, runtimeControls, stripHtml, tickerFromSlug, totalToAnnualized,
} from './update-data';
import type { CatalogFund } from './update-data';

// Live sprottetfs.com fixtures captured 2026-10-01 by the temporary probe
// workflow (run 36937950856); see .worklog.txt for the capture evidence.
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/2026-10-01/${name}`, import.meta.url), 'utf8');
const urnm = fixture('urnm-fund-page.html');
const rexc = fixture('rexc-fund-page.html');
const metl = fixture('metl-fund-page.html');
const sitemap = fixture('sitemap.xml');

describe('Sprott fund page parsing (live fixtures)', () => {
  test('URNM pricing, key facts, identifiers and returns match the published page', () => {
    const page = parseFundPage(urnm, 'URNM');
    expect(page.ticker).toBe('URNM');
    expect(page.name).toBe('Sprott Uranium Miners ETF');
    expect(page.category).toBe('Critical Materials');
    expect(page.asOfDate).toBe('2026-09-30');
    expect(page.nav).toBe(47.63);
    expect(page.marketPrice).toBe(47.5);
    expect(page.premiumDiscount).toBe(-0.27);
    expect(page.aumValue).toBe(1840000000);
    expect(page.aumDisplay).toBe('$1.84 Billion');
    expect(page.expenseRatio).toEqual({ gross: 0.75, net: 0.75, value: 0.75 });
    expect(page.identifiers).toEqual({ isin: 'US85208P3038', cusip: '85208P303', indexTicker: 'URNMX' });
    expect(page.exchange).toBe('NYSE Arca');
    expect(page.inception).toBe('2019-12-03');
    expect(page.indexRebalanceFrequency).toBe('Quarterly');
    expect(page.performance.month).toMatchObject({
      asOfDate: 'Sep 30 2026', mo1: -16.37, qtd: -9.16, ytd: -13.32, yr1: -18.52,
      yr3: 3.44, yr5: 8.01, yr10: null, sinceInception: 25.01,
    });
    // Month-end and quarter-end tables are both published with the same date.
    expect(page.performance.quarter).toEqual(page.performance.month);
  });

  test('URNM holdings come from the page CSV with numeric Weight and no currency decoration', () => {
    const page = parseFundPage(urnm, 'URNM');
    expect(page.holdings.asOfDate).toBe('2026-09-30');
    expect(page.holdings.source).toContain('Download All Holdings');
    expect(page.holdings.rows).toHaveLength(27);
    expect(page.holdings.rows[0]).toEqual({
      Name: 'Cameco Corp.', Ticker: 'CCJ', Identifier: '2158684',
      Weight: '20.49', 'Market Value': '376658199.63', 'Shares Held': '4345889', SEDOL: '2158684',
    });
    const cash = page.holdings.rows.at(-1)!;
    expect(cash.Name).toBe('Cash Equivalent');
    expect(cash.Ticker).toBe('');
    expect(cash.Weight).toBe('0.15');
  });

  test('the rendered table is an equivalent holdings fallback when the CSV link is absent', () => {
    const withoutCsv = urnm.replace(/<a\b[^>]*href="data:application\/csv;charset=utf-8,[^"]*"[^>]*>[\s\S]*?<\/a>/i, '');
    expect(withoutCsv).not.toContain('data:application/csv');
    const csv = parseHoldingsSection(urnm);
    const table = parseHoldingsSection(withoutCsv);
    expect(table.source).toContain('holdings table');
    expect(table.rows).toHaveLength(csv.rows.length);
    expect(table.rows[0]).toEqual(csv.rows[0]);
    expect(table.rows.at(-1)).toEqual(csv.rows.at(-1));
  });

  test('distributions use the Ex-Date/Total columns and skip "-" placeholder rows', () => {
    const page = parseFundPage(urnm, 'URNM');
    // The 12/15/2022 row is "-" and must not become a 0 dividend.
    expect(page.distributions.payments.map((payment) => payment.amount)).toEqual([1.1, 4.82, 1.75, 1.28, 1.74]);
    expect(page.distributions.payments.at(-1)!.epoch).toBe(Date.parse('2025-12-18T00:00:00Z') / 1000);
    expect(formatUsDate(page.distributions.payments.at(-1)!.epoch)).toBe('12/18/2025');
  });

  test('REXC (newest fund) parses without distributions and keeps its lagging month-end date', () => {
    const page = parseFundPage(rexc, 'REXC');
    expect(page.ticker).toBe('REXC');
    expect(page.category).toBe('Critical Materials');
    expect(page.distributions.payments).toEqual([]);
    expect(page.performance.month).toMatchObject({ asOfDate: 'Aug 31 2026', ytd: null });
  });

  test('METL keeps a null category when the breadcrumb points at the homepage', () => {
    const page = parseFundPage(metl, 'METL');
    expect(page.ticker).toBe('METL');
    expect(page.category).toBeNull();
    expect(page.name).toBe('Sprott Active Metals & Miners ETF');
  });
});

describe('catalog discovery', () => {
  test('the full 315-URL live sitemap yields exactly the 13 Sprott fund pages', () => {
    const pages = parseSitemapFundPages(sitemap);
    expect(sitemap).toContain('<loc>https://sprottetfs.com/insights/');
    expect(pages).toHaveLength(13);
    expect(pages).toEqual([...pages].sort());
    expect(pages[0]).toBe('https://sprottetfs.com/copj-sprott-junior-copper-miners-etf/');
    expect(pages).toContain('https://sprottetfs.com/rexc-rare-earths-ex-china-etf/');
    expect(new Set(pages).size).toBe(13);
    expect(pages.map(tickerFromSlug).sort()).toEqual(
      ['COPJ', 'COPP', 'GBUG', 'LITP', 'METL', 'NIKL', 'REXC', 'SETM', 'SGDJ', 'SGDM', 'SLVR', 'URNJ', 'URNM'],
    );
    // Landing pages that also carry an "-etf"-looking slug must be excluded.
    expect(pages).not.toContain('https://sprottetfs.com/sprott-precious-metals-etfs/');
    expect(pages).not.toContain('https://sprottetfs.com/uranium-etfs/');
  });

  test('the fund-page navigation list carries ticker, name and canonical URL', () => {
    const funds = parseCatalogNav(urnm);
    expect(funds.map((fund) => fund.ticker)).toEqual(
      ['COPJ', 'COPP', 'GBUG', 'LITP', 'METL', 'NIKL', 'REXC', 'SETM', 'SGDJ', 'SGDM', 'SLVR', 'URNJ', 'URNM'],
    );
    const urnmFund = funds.find((fund) => fund.ticker === 'URNM')!;
    expect(urnmFund.name).toBe('Sprott Uranium Miners ETF');
    // The nav link has no trailing slash; the parsed URL must still be canonical.
    expect(urnmFund.fundPage).toBe('https://sprottetfs.com/urnm-sprott-uranium-miners-etf/');
    for (const fund of funds) expect(fund.fundPage.startsWith('https://sprottetfs.com/')).toBe(true);
  });

  test('tickerFromSlug maps the sitemap slugs used for the published-identity fallback', () => {
    expect(tickerFromSlug('https://sprottetfs.com/urnm-sprott-uranium-miners-etf/')).toBe('URNM');
    expect(tickerFromSlug('https://sprottetfs.com/rexc-rare-earths-ex-china-etf')).toBe('REXC');
  });
});

describe('HTML table mapping (type-safety review)', () => {
  const table = (header: string[], rows: string[][]): string =>
    `<table><tr>${header.map((cell) => `<td>${cell}</td>`).join('')}</tr>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
      .join('')}</table>`;

  test('maps every tenor, tolerates reordered and unknown columns', () => {
    const columns: Array<[string, string]> = [
      ['S.I.', '25.01'], ['YTD*', '-13.32'], ['10 YR', '--'], ['Fund', 'Sprott Uranium Miners ETF (Net Asset Value)'],
      ['1 MO*', '-16.37'], ['3 MO*', '-9.16'], ['Unknown', 'x'], ['1 YR', '-18.52'], ['5 YR', '8.01'], ['3 YR', '3.44'],
    ];
    const reordered = table(columns.map(([header]) => header), [columns.map(([, value]) => value)]);
    expect(parseReturnTable(reordered)).toEqual({
      ytd: -13.32, yr1: -18.52, yr3: 3.44, yr5: 8.01, yr10: null,
      sinceInception: 25.01, mo1: -16.37, qtd: -9.16,
    });
  });

  test('keeps real zero and negative values, nulls placeholders, ignores the benchmark rows', () => {
    const values = table(
      ['Fund', '1 MO*', '3 MO*', 'YTD*', '1 YR', '3 YR', '5 YR', '10 YR', 'S.I.1'],
      [
        ['Sprott Gold Miners ETF (Market Price)', '9', '9', '9', '9', '9', '9', '9', '9'],
        ['Some Benchmark (Benchmark)', '1', '1', '1', '1', '1', '1', '1', '1'],
        ['Sprott Gold Miners ETF (Net Asset Value)', '0', '-7.5', '--', '', 'n/a', '-0.01', '12', '--'],
      ],
    );
    expect(parseReturnTable(values)).toEqual({
      ytd: null, yr1: null, yr3: null, yr5: -0.01, yr10: 12,
      sinceInception: null, mo1: 0, qtd: -7.5,
    });
  });

  test('an unknown-only header row yields an all-null mapping instead of throwing', () => {
    expect(parseReturnTable(table(['a', 'b'], [['1', '2']]))).toEqual({
      ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, mo1: null, qtd: null,
    });
  });

  test('performance blocks require their published "As of" date', () => {
    const page = parseSprottPerformance('<h3>Month-End Performance</h3><p class="small">Average Annual Total Returns (%) As of 9/30/2026</p>'
      + table(['Fund', '1 MO*'], [['Sprott Uranium Miners ETF (Net Asset Value)', '1']]));
    expect(page.month).toBeNull();
    expect(page.quarter).toBeNull();
  });
});

describe('distributions parsing', () => {
  test('all-placeholder tables yield no payments and never a zero amount', () => {
    const html = '<table id="DistributionsData"><tr><td>Ex-Date</td><td>Total Distributions</td></tr>'
      + '<tr><td>12/15/2022</td><td>-</td></tr><tr><td>n/a</td><td>$0.00</td></tr></table>';
    const parsed = parseDistributionsSection(html);
    expect(parsed.payments).toEqual([]);
  });

  test('headers and amounts keep their published shape', () => {
    const html = '<table id="DistributionsData"><tr><td>Ex-Date</td><td>Record Date</td><td>Total Distributions</td></tr>'
      + '<tr><td>12/18/2025</td><td>12/18/2025</td><td>$1.74</td></tr></table>';
    const parsed = parseDistributionsSection(html);
    expect(parsed.headers).toEqual(['Ex-Date', 'Amount']);
    expect(parsed.payments).toEqual([{ epoch: Date.parse('2025-12-18T00:00:00Z') / 1000, amount: 1.74 }]);
  });
});

describe('HTML helpers', () => {
  test('decodes the named, decimal and hexadecimal entities the Umbraco pages emit', () => {
    expect(decodeEntities('Nasdaq&#xAE; &amp; Co&nbsp;&#8217;26')).toBe("Nasdaq® & Co '26");
    expect(stripHtml('<td class="left">\n  Cameco Corp.\n</td>')).toBe('Cameco Corp.');
  });

  test('parseMoneyText handles dollars, grouping, negatives and word suffixes', () => {
    expect(parseMoneyText('$47.63')).toBe(47.63);
    expect(parseMoneyText('-$0.57')).toBe(-0.57);
    expect(parseMoneyText('$1.84 Billion')).toBe(1840000000);
    expect(parseMoneyText('526.07 Million')).toBe(526070000);
    expect(parseMoneyText('—')).toBeNull();
  });

  test('parsePercentText and parseLongDate only accept what the page publishes', () => {
    expect(parsePercentText('-0.27%')).toBe(-0.27);
    expect(parsePercentText('0.75%')).toBe(0.75);
    expect(parsePercentText('Quarterly')).toBeNull();
    expect(parseLongDate('As of September 30, 2026')).toBe('2026-09-30');
    expect(parseLongDate('As of Foo 3, 2026')).toBeNull();
  });

  test('number helpers keep zero/negative values and strip published decoration', () => {
    expect(numberOrNull('20.49%')).toBe(20.49);
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('0')).toBe(0);
    expect(numberOrNull('-')).toBeNull();
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(isoDate('9/30/2026')).toBe('2026-09-30');
    expect(formatEdgarDate('2026-09-30')).toBe('Sep 30 2026');
  });

  test('fees table keeps a real zero (Other Expenses) instead of dropping it', () => {
    expect(parseFeesTable(urnm)).toEqual({
      'Management Fee': 0.75, 'Other Expenses': 0, 'Total Annual Fund Operating Expenses': 0.75,
    });
    expect(cellsIn('<tr><td class="left">a</td><td class="right">b</td></tr>')).toEqual(['a', 'b']);
  });
});

describe('SEC N-PORT-P fallback', () => {
  const xml = `<?xml version="1.0"?><edgarSubmission><formData><genInfo>
    <regName>SPROTT FUNDS TRUST</regName><regCik>0001728683</regCik>
    <seriesName>Sprott Uranium Miners ETF</seriesName><seriesId>S000068011</seriesId>
    <repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1500000000</netAssets></fundInfo>
    <invstOrSecs><invstOrSec><name>Cameco Corp.</name><pctVal>20.49</pctVal><valUSD>376658199.63</valUSD>
    <balance>4345889</balance><assetCat>EC</assetCat>
    <identifiers><isin value="CA13321L1085"/><sedol value="2158684"/></identifiers></invstOrSec></invstOrSecs>
    </formData></edgarSubmission>`;

  test('identity fields and holdings rows are read from the filing, not invented', () => {
    const parsed = parseNport(xml);
    expect(parsed.regName).toBe('SPROTT FUNDS TRUST');
    expect(parsed.regCik).toBe('0001728683');
    expect(parsed.seriesName).toBe('Sprott Uranium Miners ETF');
    expect(parsed.seriesId).toBe('S000068011');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.netAssets).toBe(1500000000);
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.holdings[0]).toMatchObject({
      Name: 'Cameco Corp.', Weight: '20.49', 'Market Value': '376658199.63', 'Shares Held': '4345889', 'Asset Category': 'EC',
    });
    expect(parsed.holdings[0].Identifier).toBe('CA13321L1085');
  });
});

describe('derived metrics', () => {
  test('annualized/total conversions round to two decimals', () => {
    expect(annualizedToTotal(3.44, 3)).toBe(10.68);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(totalToAnnualized(10.68, 3)).toBe(3.44);
    expect(totalToAnnualized(-100, 1)).toBe(-100);
  });

  test('indicated yield needs a positive distribution, cadence and price', () => {
    expect(indicatedYield(1.74, 1, 47.5)).toBe(3.66);
    expect(indicatedYield(0, 1, 47.5)).toBeNull();
    expect(indicatedYield(1.74, null, 47.5)).toBeNull();
    expect(indicatedYield(1.74, 1, 0)).toBeNull();
  });

  test('distribution frequency inference covers annual/semi/quarter gaps and unknowns', () => {
    const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: at('2025-12-18'), amount: 1.74 }]))
      .toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([
      { epoch: at('2023-12-14'), amount: 1.75 }, { epoch: at('2024-12-12'), amount: 1.28 },
      { epoch: at('2025-12-18'), amount: 1.74 },
    ])).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([
      { epoch: at('2025-03-31'), amount: 0.1 }, { epoch: at('2025-06-30'), amount: 0.1 },
      { epoch: at('2025-09-30'), amount: 0.1 }, { epoch: at('2025-12-31'), amount: 0.1 },
    ])).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency([
      { epoch: at('2025-06-30'), amount: 0.1 }, { epoch: at('2025-12-31'), amount: 0.1 },
    ])).toEqual({ frequency: 'Semi-annually', paymentsPerYear: 2 });
  });
});

describe('repository configuration / Actions override precedence', () => {
  test('file < advanced JSON < explicit input < environment (brand alias wins)', () => {
    const controls = resolveControls(
      { CONCURRENCY: 2, TICKERS: 'URNM' },
      { CONCURRENCY: 3, TICKERS: 'SETM' },
      { CONCURRENCY: '4', TICKERS: '' },
      { SPROTT_CONCURRENCY: '5' },
    );
    expect(controls).toEqual({ CONCURRENCY: '5', TICKERS: 'SETM' });
  });

  test('empty dispatch inherits the file, advanced empty ticker resets the selection', () => {
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  });

  test('the advanced JSON covers controls that do not fit the 25 dispatch inputs', () => {
    const controls = resolveControls({}, { SEC_UA: 'ops contact', VERBOSE: 'true', SKIP_SPROTT: 'true' });
    expect(controls.SEC_UA).toBe('ops contact');
    expect(controls.VERBOSE).toBe('true');
    expect(controls.SKIP_SPROTT).toBe('true');
  });

  test('unknown keys, multiline injection and invalid values are rejected', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 },
      { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { AUM: '1:2:3' },
      { TICKERS: ['URNM'] }, { TICKERS: { a: 1 } }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { SPROTT_SEC_UA: 'a\nb' })).toThrow();
  });

  test('a protected SEC_UA passed as env wins over every other layer', () => {
    const file = JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, {}).SEC_UA).toBe('in');
  });

  test('MAX_RETRIES needs an integer of at least 1 and MAX_FETCHES 0 stays valid', () => {
    expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
    expect(readConfig(resolveControls({ MAX_FETCHES: 0 })).maxFetches).toBe(0);
  });

  test('HISTORY_RANGE and filters flow through readConfig, and runtimeControls applies env overrides', async () => {
    const config = readConfig(resolveControls({ HISTORY_RANGE: '5y', AUM: '100M:', TER: ':0.7', TICKERS: 'urnm, setm;URNJ' }));
    expect(config.historyRange).toBe('5y');
    expect(config.tickers).toEqual(['URNM', 'SETM', 'URNJ']);
    expect(config.terRange?.max).toBe(0.7);
    expect(config.aumRange?.min).toBe(100_000_000);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    expect((await runtimeControls({ SPROTT_TICKERS: 'URNM' })).TICKERS).toBe('URNM');
  });

  test('an empty dispatch inherits the config file and every canonical control is present', () => {
    const file = JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.requestSleep).toBe(1);
    expect(config.concurrency).toBe(2);
    expect(config.skipSprott).toBe(false);
    expect(config.edgarFallback).toBe(true);
    expect(config.skipYahoo).toBe(false);
  });

  test('the update workflow stays at or below the 25-input dispatch cap', () => {
    const text = readFileSync(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
    const inputSection = text.split('    inputs:')[1].split('\npermissions:')[0];
    expect([...inputSection.matchAll(/^      [a-z0-9_]+:/gm)].length).toBe(25);
    expect(inputSection).toContain('      concurrency:');
    expect(inputSection).toContain('      tickers:');
    expect(inputSection).toContain('      advanced:');
    expect(text).not.toMatch(/^  push:/m);
    expect(text).toContain('bun install --frozen-lockfile');
    expect(text).not.toContain('bunx tsc');
  });
});

describe('history merge stability', () => {
  const day = (date: string, adjClose: number) => ({ date, close: 36.540001, adjClose, volume: 9000 });
  const previous = [{ Date: 'Oct 10 2016', Close: '36.540001', 'Adj Close': '27.69', Volume: '9000' }];

  test('a published adjusted close keeps its cent when Yahoo jitters a rounding boundary', () => {
    const merged = mergeHistory(previous, [day('2016-10-10', 27.7)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]['Adj Close']).toBe('27.69');
  });

  test('a genuine restatement still replaces the published row', () => {
    const merged = mergeHistory(previous, [day('2016-10-10', 27.85)]);
    expect(merged[0]['Adj Close']).toBe('27.85');
  });

  test('new days merge in date order', () => {
    const merged = mergeHistory([], [day('2016-10-10', 27.7), day('2016-10-11', 27.9)]);
    expect(merged.map((row) => row.Date)).toEqual(['Oct 10 2016', 'Oct 11 2016']);
    expect(merged[0]['Adj Close']).toBe('27.7');
  });
});

describe('batch selection', () => {
  const fund = (ticker: string): CatalogFund => ({
    ticker, name: ticker, fundPage: `https://sprottetfs.com/${ticker.toLowerCase()}-etf/`,
    assetClass: '', isin: '', nav: null, navDate: null,
  });
  const funds = ['COPJ', 'COPP', 'GBUG', 'URNM'].map(fund);

  test('TICKERS filters and MAX_FETCHES resumes from the cursor without dropping funds', () => {
    const config = readConfig(resolveControls({ TICKERS: 'URNM COPP', MAX_FETCHES: '0' }));
    expect(batchSelection(funds, config, null).map((item) => item.ticker)).toEqual(['COPP', 'URNM']);
    const bounded = readConfig(resolveControls({ MAX_FETCHES: '2' }));
    expect(batchSelection(funds, bounded, null).map((item) => item.ticker)).toEqual(['COPJ', 'COPP']);
    expect(batchSelection(funds, bounded, 'COPJ').map((item) => item.ticker)).toEqual(['COPP', 'GBUG']);
    expect(batchSelection(funds, bounded, 'URNM').map((item) => item.ticker)).toEqual(['COPJ', 'COPP']);
  });
});
