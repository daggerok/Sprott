/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  CONTROL_NAMES, USAGE, annualizedToTotal, batchSelection, cellsIn, decodeEntities, formatEdgarDate,
  formatUsDate, indicatedYield, inferDistributionFrequency, isoDate, mergeHistory, normalizeNumberText, numberOrNull,
  parseCatalogNav, parseFeesTable, parseFundPage, parseHoldingsSection, parseLongDate, parseMoneyText,
  parseNport, parsePercentText, parseSitemapFundPages, parseSprottPerformance, parseReturnTable,
  parseDistributionsSection, resolveControls, readConfig, runPool, runtimeControls, stripHtml, tickerFromSlug, totalToAnnualized,
} from './update-data';
import type { CatalogFund } from './update-data';

// Small inline samples shaped like the sprottetfs.com pages (no captured files).
const holdingsCsv = [
  'Security,Symbol,SEDOL,Weight,Market Value,Quantity',
  'Cameco Corp.,CCJ,2158684,20.49,376658199.63,4345889',
  'Cash Equivalent,,,0.15,2757000.00,',
].join('\n');
const holdingsTable = '<table><tr><th>Security</th><th>Market Value</th><th>Symbol</th><th>SEDOL</th><th>Quantity</th><th>Weight</th></tr>'
  + '<tr><td>Cameco Corp.</td><td>376,658,199.63</td><td>CCJ</td><td>2158684</td><td>4,345,889</td><td>20.49</td></tr>'
  + '<tr><td>Cash Equivalent</td><td>2,757,000.00</td><td></td><td></td><td></td><td>0.15</td></tr></table>';
const perfTable = (rows: string): string => '<table><tr><td>Fund</td><td>1 MO*</td><td>3 MO*</td><td>YTD*</td><td>1 YR</td><td>3 YR</td><td>5 YR</td><td>10 YR</td><td>S.I.</td></tr>'
  + rows + '</table>';
const pageHtml = (opts: { csv?: boolean; breadcrumb?: string } = {}): string => `<html><head>
<script type="application/ld+json">${JSON.stringify({ '@graph': [
  { '@type': 'InvestmentFund', name: 'Sprott Uranium Miners ETF' },
  { '@type': 'BreadcrumbList', itemListElement: [{ item: opts.breadcrumb ?? 'https://sprottetfs.com/critical-materials/' }] },
] })}</script></head><body>
<h2 id="asOfDate">As of September 30, 2026</h2>
<section><h3 class="color-gold">NAV</h3><h4>$47.63</h4><h3 class="color-gold">Market Price</h3><h4>$47.50</h4>
<h3 class="color-gold">Premium/Discount</h3><h4>-0.27%</h4><h3 class="color-gold">Ticker</h3><h4>URNM</h4>
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
const navHtml = ['COPJ', 'URNM', 'SETM'].map((ticker) =>
  `<a href="/${ticker.toLowerCase()}-sprott-etf" title="Sprott ${ticker} ETF" class=" phv-btn purple-bg large">${ticker}</a>`).join('')
  + '<a href="#secPurchase" title="Invest" class=" phv-btn gry-bg large">Invest Now</a>';
const sitemap = ['copj-sprott-junior-copper-miners-etf/', 'urnm-sprott-uranium-miners-etf', 'rexc-rare-earths-ex-china-etf/',
  'sprott-precious-metals-etfs/', 'insights/foo/', 'uranium-etfs/']
  .map((slug) => `<url><loc>https://sprottetfs.com/${slug}</loc></url>`).join('\n');

describe('Sprott fund page parsing (inline samples)', () => {
  test('pricing, key facts, identifiers and returns match the page', () => {
    const page = parseFundPage(pageHtml(), 'URNM');
    expect(page.ticker).toBe('URNM');
    expect(page.name).toBe('Sprott Uranium Miners ETF');
    expect(page.category).toBe('Critical Materials');
    expect(page.asOfDate).toBe('2026-09-30');
    expect(page.nav).toBe(47.63);
    expect(page.marketPrice).toBe(47.5);
    expect(page.premiumDiscount).toBe(-0.27);
    expect(page.aumValue).toBe(1840000000);
    expect(page.expenseRatio).toEqual({ gross: 0.75, net: 0.75, value: 0.75 });
    expect(page.identifiers).toEqual({ isin: 'US85208P3038', cusip: '85208P303', indexTicker: 'URNMX' });
    expect(page.exchange).toBe('NYSE Arca');
    expect(page.inception).toBe('2019-12-03');
    expect(page.indexRebalanceFrequency).toBe('Quarterly');
    expect(page.performance.month).toMatchObject({
      asOfDate: 'Sep 30 2026', mo1: -16.37, qtd: -9.16, ytd: -13.32, yr1: -18.52, yr3: 3.44, yr5: 8.01, yr10: null, sinceInception: 25.01,
    });
    expect(page.performance.quarter).toEqual(page.performance.month);
    expect(parseFeesTable(pageHtml())).toEqual({
      'Management Fee': 0.75, 'Other Expenses': 0, 'Total Annual Fund Operating Expenses': 0.75,
    });
  });

  test('holdings come from the page CSV with numeric Weight', () => {
    const holdings = parseHoldingsSection(pageHtml());
    expect(holdings.asOfDate).toBe('2026-09-30');
    expect(holdings.source).toContain('Download All Holdings');
    expect(holdings.rows).toHaveLength(2);
    expect(holdings.rows[0]).toEqual({
      Name: 'Cameco Corp.', Ticker: 'CCJ', Identifier: '2158684',
      Weight: '20.49', 'Market Value': '376658199.63', 'Shares Held': '4345889', SEDOL: '2158684',
    });
    expect(holdings.rows[1]).toMatchObject({ Name: 'Cash Equivalent', Ticker: '', Weight: '0.15' });
  });

  test('the rendered table is an equivalent holdings fallback when the CSV link is absent', () => {
    const csv = parseHoldingsSection(pageHtml());
    const table = parseHoldingsSection(pageHtml({ csv: false }));
    expect(table.source).toContain('holdings table');
    expect(table.rows).toEqual(csv.rows);
  });

  test('distributions skip "-" placeholder rows and sort by date', () => {
    const page = parseFundPage(pageHtml(), 'URNM');
    expect(page.distributions.payments.map((payment) => payment.amount)).toEqual([1.75, 1.74]);
    expect(formatUsDate(page.distributions.payments.at(-1)!.epoch)).toBe('12/18/2025');
  });

  test('a breadcrumb that points at the homepage keeps a null category', () => {
    expect(parseFundPage(pageHtml({ breadcrumb: 'https://sprottetfs.com/' }), 'METL').category).toBeNull();
  });
});

describe('catalog discovery', () => {
  test('the sitemap yields only fund pages, canonical and sorted', () => {
    const pages = parseSitemapFundPages(sitemap);
    expect(pages).toEqual([
      'https://sprottetfs.com/copj-sprott-junior-copper-miners-etf/',
      'https://sprottetfs.com/rexc-rare-earths-ex-china-etf/',
      'https://sprottetfs.com/urnm-sprott-uranium-miners-etf/',
    ]);
    expect(pages.map(tickerFromSlug)).toEqual(['COPJ', 'REXC', 'URNM']);
  });

  test('the fund-navigation list carries ticker, name and canonical URL, skipping anchors', () => {
    const funds = parseCatalogNav(navHtml);
    expect(funds.map((fund) => fund.ticker)).toEqual(['COPJ', 'SETM', 'URNM']);
    expect(funds.find((fund) => fund.ticker === 'URNM')!.fundPage).toBe('https://sprottetfs.com/urnm-sprott-etf/');
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
    expect(parseFeesTable(pageHtml())).toEqual({
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

// ---------------------------------------------------------------------------
// Configuration, documentation and workflow contracts
// ---------------------------------------------------------------------------
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;
const readme = read('README.md');

describe('resolver precedence (file < advanced < nonblank input < env)', () => {
  test('each layer overrides the previous one and the brand alias wins as env', () => {
    const controls = resolveControls(
      { CONCURRENCY: 2, TICKERS: 'URNM' },
      { CONCURRENCY: 3, TICKERS: 'SETM' },
      { CONCURRENCY: '4', TICKERS: '' },
      { SPROTT_CONCURRENCY: '5' },
    );
    expect(controls).toEqual({ CONCURRENCY: '5', TICKERS: 'SETM' });
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  });

  test('blank dispatch inputs inherit, advanced can clear a key on purpose', () => {
    expect(resolveControls({ TICKERS: 'URNM' }, {}, { TICKERS: '' }).TICKERS).toBe('URNM');
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  });

  test('an explicitly set env var wins even when empty, and env beats every other layer', () => {
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: 'SETM' }, { TICKERS: 'URNJ' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'URNM' }, {}, {}, { TICKERS: 'SETM' }).TICKERS).toBe('SETM');
    expect(resolveControls({ TICKERS: 'URNM' }, {}, {}, { SPROTT_TICKERS: 'SETM', TICKERS: 'COPJ' }).TICKERS).toBe('SETM');
  });

  test('legacy env aliases keep working', () => {
    expect(resolveControls({}, {}, {}, { SPROTT_LIMIT: '3' }).MAX_FETCHES).toBe('3');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
  });

  test('the scheduled path (empty inputs and advanced) equals the config defaults', () => {
    expect(resolveControls(file, {}, {}, {})).toEqual(file);
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.requestSleep).toBe(1);
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(2);
    expect(config.historyRange).toBe('max');
    expect(config.skipSprott).toBe(false);
    expect(config.skipYahoo).toBe(false);
    expect(config.edgarFallback).toBe(true);
    expect(config.storeRawDownloads).toBe(false);
  });

  test('runtimeControls reads the config file and applies env overrides', async () => {
    expect((await runtimeControls({})).SEC_UA).toBe(file.SEC_UA);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
    expect((await runtimeControls({ SPROTT_TICKERS: 'URNM' })).TICKERS).toBe('URNM');
  });
});

describe('resolver validation', () => {
  test('unknown keys, non-scalars, newlines and invalid values are rejected', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' },
      { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_RETRIES: '1.5' }, { MAX_FETCHES: 1.5 },
      { HOLDINGS_PAGE_SIZE: 0 }, { HISTORY_PAGE_SIZE: 'x' }, { REQUEST_SLEEP: '-1' }, { REQUEST_SLEEP: 'abc' },
      { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'perhaps' }, { AUM: '1:2:3' }, { AUM: '5' },
      { TER: '2:1' }, { PERFORMANCE_1Y: 'a:b' }, { TOTAL_RETURN_10Y: '1' },
      { TICKERS: ['URNM'] }, { TICKERS: { a: 1 } }, { TICKERS: null },
    ]) {
      expect(() => resolveControls(value)).toThrow();
      expect(() => resolveControls({}, value)).toThrow();
    }
    for (const bad of [null, [], 'x', 1]) expect(() => resolveControls(bad)).toThrow();
    expect(() => resolveControls({}, {}, {}, { SPROTT_SEC_UA: 'a\nb' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
  });

  test('MAX_RETRIES needs an integer of at least 1, MAX_FETCHES 0 stays valid', () => {
    expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
    expect(readConfig(resolveControls({ MAX_FETCHES: 0 })).maxFetches).toBe(0);
  });

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

  test('SEC_UA defaults to the daggerok contact, is overridable and is redacted in logs', async () => {
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({}).secUa).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }).SEC_UA).toBe('in');
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], { cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe' });
    const help = await new Response(child.stdout).text();
    await child.exited;
    expect(help).toContain('SEC_UA=<redacted>');
    expect(help.slice(help.indexOf('[ config'))).not.toContain('gmail.com');
  });
});

describe('worker pool (CONCURRENCY)', () => {
  test('runs up to CONCURRENCY tasks at once and handles every item exactly once', async () => {
    let inFlight = 0, peak = 0;
    const seen: number[] = [];
    await runPool(Array.from({ length: 30 }, (_, i) => i), 15, async (item) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item); inFlight--;
    });
    expect(peak).toBe(15);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  test('CONCURRENCY=1 is sequential and a pool larger than the queue starts no idle workers', async () => {
    let inFlight = 0, peak = 0;
    const run = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; };
    await runPool([1, 2, 3], 1, run);
    expect(peak).toBe(1);
    peak = 0;
    await runPool([1, 2], 15, run);
    expect(peak).toBe(2);
  });
});

describe('--help, config file and README parity', () => {
  const rows = readme
    .slice(readme.indexOf('| Environment variable |'))
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => /^\| `([A-Z0-9_]+)` \| (.*?) \| /.exec(line)!);
  const documentedAs: Record<string, string> = { TICKERS: 'all' };

  test('config keys equal CONTROL_NAMES equal README rows', () => {
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    expect(rows.map(([, name]) => name).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
  });

  test('each documented default equals the checked-in config value', () => {
    for (const [, name, shown] of rows) expect(shown).toBe(documentedAs[name] ?? `\`${file[name]}\``);
  });

  test('--help lists every control independent of the cwd', async () => {
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], {
      cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe',
    });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/);
      expect(USAGE).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
      expect(help).toContain(name);
    }
  });

  test('the script is directly executable and keeps its type reference', () => {
    const lines = read('scripts/update-data.ts').split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bun');
    expect(lines[1]).toBe('/// <reference types="bun" />');
  });
});

describe('README structure', () => {
  test('required headings in order, live deployment, verification and disclaimer', () => {
    const headings = [...readme.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,3} (.*)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Sprott', 'Using Bun', 'Updating the static Sprott data', 'Data sources', 'Metrics and caveats', 'Update controls',
      'Examples', 'TypeScript and verification', 'Brands table', 'Sibling applications', 'License',
    ]);
    expect(readme).toContain('https://daggerok.github.io/Sprott/');
    expect(readme).not.toMatch(/pending/i);
    expect(readme).toMatch(/not affiliated with, endorsed by, or sponsored by Sprott/);
    for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) {
      expect(readme).toContain(command);
    }
  });

  test('Sprott appears once in each shared table', () => {
    expect(readme.match(/^\| \*\*Sprott ETFs\*\* \|/gm)).toHaveLength(1);
    expect(readme.match(/^\| Sprott ETFs \|/gm)).toHaveLength(1);
    expect(readme).toContain('[Sprott](https://github.com/daggerok/Sprott)');
  });
});

describe('update workflow', () => {
  const workflow = read('.github/workflows/update-data.yml');
  const inputsBlock = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
  const inputNames = [...inputsBlock.matchAll(/^      ([a-z0-9_]+):$/gm)].map((m) => m[1]);

  test('at most 25 inputs, advanced present, every named input maps to a control', () => {
    expect(inputNames.length).toBeLessThanOrEqual(25);
    expect(inputNames).toContain('advanced');
    expect(inputNames).toContain('concurrency');
    expect(inputNames).toContain('tickers');
    for (const name of inputNames.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
    expect(inputsBlock).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  });

  test('weekly schedule, no push trigger, fixed output dir, hardened credentials', () => {
    expect(workflow).toContain("cron: '0 0 * * 0'");
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).not.toMatch(/OUTPUT_DIR/);
    expect([...workflow.matchAll(/git add (.+)$/gm)].map((m) => m[1].trim())).toEqual(['api/sprott']);
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('timeout-minutes: 30');
    expect(workflow).toContain('DISPATCH_INPUTS: ${{ toJSON(inputs) }}');
    expect(workflow).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(workflow).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
    expect(workflow).toContain('bun install --frozen-lockfile');
  });
});
