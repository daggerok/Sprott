/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  CONTROL_NAMES, USAGE, annualizedToTotal, batchSelection, cellsIn, decodeEntities, formatEdgarDate,
  formatUsDate, indicatedYield, inferDistributionFrequency, isoDate, mergeHistory, normalizeNumberText, numberOrNull,
  parseCatalogNav, parseFeesTable, parseFundPage, parseHoldingsSection, parseLongDate, parseMoneyText,
  parseNport, parsePercentText, parseSitemapFundPages, parseSprottPerformance, parseReturnTable,
  parseDistributionsSection, resolveControls, readConfig, stripHtml, tickerFromSlug, totalToAnnualized,
} from './update-data';
import type { CatalogFund } from './update-data';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Small inline samples shaped like sprottetfs.com fund pages (no captured pages).
const csv = [
  'Security,Market Value,Symbol,SEDOL,Quantity,Weight',
  'Cameco Corp.,376658199.63,CCJ,2158684,4345889.00,20.49',
  'Sprott Physical Uranium Trust,279061481.10,U-U CN,BNZKG52,14924703.00,15.18',
  'Cash Equivalent,2760000.00,,,,0.15',
].join('\r\n');
const csvLink = `<a class="small" download="URNM-holdings.csv" href="data:application/csv;charset=utf-8,${encodeURIComponent(csv)}">Download All Holdings</a>`;
const holdingsTable = `<table><tbody>
  <tr><th style="text-align: left;">Security</th><th>Market Value</th><th>Symbol</th><th>SEDOL</th><th>Quantity</th><th>Weight</th></tr>
  <tr><td class="left">Cameco Corp.</td><td class="right">$376,658,199.63</td><td class="center">CCJ</td><td class="left">2158684</td><td class="right">
    4,345,889.00
  </td><td class="right">20.49%</td></tr>
  <tr><td class="left">Cash Equivalent</td><td class="right">$2,760,000.00</td><td class="center"></td><td class="left"></td><td class="right"></td><td class="right">0.15%</td></tr>
</tbody></table>`;
const fact = (label: string, value: string): string => `<div class="cell"><h3 class="color-gold">${label}</h3><h4>${value}</h4></div>`;
const returnsTable = (nav: string[]): string => `<table class="mb0"><tbody>
  <tr><td><strong>Fund</strong></td><td><strong>1 MO*</strong></td><td><strong>3 MO*</strong></td><td><strong>YTD*</strong></td><td><strong>1 YR</strong></td><td><strong>3 YR</strong></td><td><strong>5 YR</strong></td><td><strong>10 YR</strong></td><td><strong>S.I.<sup>1</sup></strong></td></tr>
  <tr><td class="text-left">Sprott Uranium Miners ETF <br>(Net Asset Value)</td>${nav.map((v) => `<td>${v}</td>`).join('')}</tr>
  <tr><td class="text-left">Sprott Uranium Miners ETF <br>(Market Price)<sup>2</sup></td>${['-1', '-1', '-1', '-1', '-1', '-1', '--', '-1'].map((v) => `<td>${v}</td>`).join('')}</tr>
  <tr><td class="text-left">Index <br>(Benchmark)<sup>5</sup></td>${['-2', '-2', '-2', '-2', '-2', '-2', '--', '-2'].map((v) => `<td>${v}</td>`).join('')}</tr>
</tbody></table>`;
const distributions = `<table class="table-responsive" id="DistributionsData">
  <tr><td><p>Ex-Date</p></td><td><p>Record Date</p></td><td><p>Ordinary Income</p></td><td><p>Total Distributions</p></td></tr>
  <tr><td><p>12/28/2021</p></td><td><p>12/29/2021</p></td><td><p>$4.82</p></td><td><p>$4.82</p></td></tr>
  <tr><td><p>12/15/2022</p></td><td><p>12/16/2022</p></td><td><p>-</p></td><td><p>-</p></td></tr>
  <tr><td><p>12/18/2025</p></td><td><p>12/19/2025</p></td><td><p>$1.74</p></td><td><p>$1.74</p></td></tr>
</table>`;
const fees = `<table><tr><td>Management Fee</td><td>0.75%</td></tr><tr><td>Other Expenses</td><td>0.00%</td></tr>
  <tr><td><strong>Total Annual Fund Operating Expenses<strong></td><td><strong>0.75%</strong></td></tr></table>`;
const jsonLd = (breadcrumbItem: string): string => `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"InvestmentFund","url":"https://sprottetfs.com/urnm-sprott-uranium-miners-etf/","name":" Sprott Uranium Miners ETF"},
  {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":"https://sprottetfs.com/"},{"@type":"ListItem","position":2,"item":"${breadcrumbItem}"}]}]}</script>`;
const fundPage = (options: { csv?: boolean; breadcrumb?: string; distributions?: boolean; monthDate?: string; nav?: string[] } = {}): string => `<html><head>${jsonLd(options.breadcrumb ?? 'https://sprottetfs.com/critical-materials')}</head><body>
<h2 class="header-underlined" id="asOfDate">
  As of September 30, 2026
</h2>
${fact('NAV', '$47.63')}${fact('Ticker', 'URNM')}${fact('Market Price<sup>2</sup>', '$47.50')}${fact('Premium/Discount<sup>3</sup>', '-0.27%')}
${fact('Total Net Asset Value', '$1.84 Billion')}${fact('Net Total Expense Ratio<sup>4</sup>', '0.75%')}
${fact('Listing Exchange', 'NYSE Arca')}${fact('Benchmark Index', 'URNMX')}${fact('Index Rebalance Frequency', 'Quarterly')}
${fact('Inception Date', 'December 3, 2019 ')}
<div class="cell"><h3 class="color-gold">ISIN</h3><details><summary>Show ISIN</summary><h4>ISIN: US85208P3038</h4></details></div>
<div class="cell"><h3 class="color-gold">CUSIP</h3><details><summary>Show CUSIP</summary><h4>CUSIP: 85208P303</h4></details></div>
${fees}
<div class="holdings-table"><p class="update-date">As of 9/30/2026</p>${options.csv === false ? '' : csvLink}${holdingsTable}</div>
${options.distributions === false ? '' : distributions}
<div class="performance-data"><h3>Month-End Performance</h3><p class="small">Average Annual Total Returns (%) As of ${options.monthDate ?? '9/30/2026'}</p>
${returnsTable(options.nav ?? ['-16.37', '-9.16', '-13.32', '-18.52', '3.44', '8.01', '--', '25.01'])}
<h3>Quarter-End Performance</h3><p class="small">Average Annual Total Returns (%) As of ${options.monthDate ?? '9/30/2026'}</p>
${returnsTable(options.nav ?? ['-16.37', '-9.16', '-13.32', '-18.52', '3.44', '8.01', '--', '25.01'])}</div>
</body></html>`;
const urnm = fundPage();
const sitemap = ['https://sprottetfs.com/', 'https://sprottetfs.com/insights/', 'https://sprottetfs.com/urnm-sprott-uranium-miners-etf/',
  'https://sprottetfs.com/copj-sprott-junior-copper-miners-etf', 'https://sprottetfs.com/rexc-rare-earths-ex-china-etf/',
  'https://sprottetfs.com/sprott-precious-metals-etfs/', 'https://sprottetfs.com/uranium-etfs/', 'https://sprottetfs.com/urnm-sprott-uranium-miners-etf/']
  .map((url) => `<url><loc>${url}</loc></url>`).join('\n');

describe('Sprott fund page parsing (inline samples)', () => {
  test('pricing, key facts, identifiers and returns match the page layout', () => {
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
    expect(page.performance.quarter).toEqual(page.performance.month);
  });

  test('holdings come from the page CSV with numeric Weight and no currency decoration', () => {
    const page = parseFundPage(urnm, 'URNM');
    expect(page.holdings.asOfDate).toBe('2026-09-30');
    expect(page.holdings.source).toContain('Download All Holdings');
    expect(page.holdings.rows).toHaveLength(3);
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
    const withoutCsv = fundPage({ csv: false });
    expect(withoutCsv).not.toContain('data:application/csv');
    const fromCsv = parseHoldingsSection(urnm);
    const table = parseHoldingsSection(withoutCsv);
    expect(table.source).toContain('holdings table');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(fromCsv.rows[0]);
    expect(table.rows.at(-1)).toEqual(fromCsv.rows.at(-1));
  });

  test('distributions use the Ex-Date/Total columns and skip "-" placeholder rows', () => {
    const page = parseFundPage(urnm, 'URNM');
    // The 12/15/2022 row is "-" and must not become a 0 dividend.
    expect(page.distributions.payments.map((payment) => payment.amount)).toEqual([4.82, 1.74]);
    expect(page.distributions.payments.at(-1)!.epoch).toBe(Date.parse('2025-12-18T00:00:00Z') / 1000);
    expect(formatUsDate(page.distributions.payments.at(-1)!.epoch)).toBe('12/18/2025');
  });

  test('a fund without distributions parses and keeps a lagging month-end date', () => {
    const page = parseFundPage(fundPage({ distributions: false, monthDate: '8/31/2026', nav: ['1', '2', '--', '4', '5', '6', '7', '8'] }), 'REXC');
    expect(page.distributions.payments).toEqual([]);
    expect(page.performance.month).toMatchObject({ asOfDate: 'Aug 31 2026', ytd: null, yr1: 4 });
  });

  test('the category stays null when the breadcrumb points at the homepage', () => {
    const page = parseFundPage(fundPage({ breadcrumb: 'https://sprottetfs.com/' }), 'METL');
    expect(page.category).toBeNull();
    expect(page.name).toBe('Sprott Uranium Miners ETF');
  });
});

describe('catalog discovery', () => {
  test('the sitemap yields only canonical fund pages, sorted and deduplicated', () => {
    const pages = parseSitemapFundPages(sitemap);
    expect(pages).toEqual([
      'https://sprottetfs.com/copj-sprott-junior-copper-miners-etf/',
      'https://sprottetfs.com/rexc-rare-earths-ex-china-etf/',
      'https://sprottetfs.com/urnm-sprott-uranium-miners-etf/',
    ]);
    expect(pages.map(tickerFromSlug)).toEqual(['COPJ', 'REXC', 'URNM']);
    // Landing pages that carry an "-etfs" slug must be excluded.
    expect(pages).not.toContain('https://sprottetfs.com/sprott-precious-metals-etfs/');
    expect(pages).not.toContain('https://sprottetfs.com/uranium-etfs/');
  });

  test('the fund-page navigation list carries ticker, name and canonical URL', () => {
    const nav = `<a href="/setm-sprott-critical-materials-etf/" title="Sprott Critical Materials ETF" class="phv-btn purple-bg large" data-anchor="#">SETM</a>
      <a href="/urnm-sprott-uranium-miners-etf" title="Sprott Uranium Miners ETF" class="phv-btn yellow-bg large" data-anchor="#">URNM</a>
      <a style="color: #fff;" href="#secPurchase" class=" phv-btn gry-bg large ">Invest Now </a>`;
    const funds = parseCatalogNav(nav);
    expect(funds.map((fund) => fund.ticker)).toEqual(['SETM', 'URNM']);
    const urnmFund = funds.find((fund) => fund.ticker === 'URNM')!;
    expect(urnmFund.name).toBe('Sprott Uranium Miners ETF');
    // The nav link has no trailing slash; the parsed URL must still be canonical.
    expect(urnmFund.fundPage).toBe('https://sprottetfs.com/urnm-sprott-uranium-miners-etf/');
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

describe('control resolver', () => {
  const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, string>;

  test('file < advanced < nonblank input < environment (brand alias wins)', () => {
    const controls = resolveControls(
      { CONCURRENCY: 2, TICKERS: 'URNM' },
      { CONCURRENCY: 3, TICKERS: 'SETM' },
      { CONCURRENCY: '4', TICKERS: '' },
      { SPROTT_CONCURRENCY: '5' },
    );
    expect(controls).toEqual({ CONCURRENCY: '5', TICKERS: 'SETM' });
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('blank input inherits the file; an explicitly set empty env or advanced value clears it', () => {
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'URNM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'URNM' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('the advanced JSON reaches controls without a dispatch input', () => {
    const controls = resolveControls({}, { SEC_UA: 'ops contact', VERBOSE: 'true', SKIP_SPROTT: 'true', STORE_RAW_DOWNLOADS: true });
    expect(controls).toEqual({ SEC_UA: 'ops contact', VERBOSE: 'true', SKIP_SPROTT: 'true', STORE_RAW_DOWNLOADS: 'true' });
  });

  test('a protected SEC_UA passed as env wins over every other layer', () => {
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, { SEC_UA: 'protected' }).SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'adv' }, { SEC_UA: 'in' }, {}).SEC_UA).toBe('in');
  });

  test('unknown keys, newlines, non-scalars and invalid values are rejected', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 },
      { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { AUM: '1:2:3' },
      { TICKERS: ['URNM'] }, { TICKERS: { a: 1 } }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { SPROTT_SEC_UA: 'a\nb' })).toThrow();
    expect(() => resolveControls(file, 'x')).toThrow();
    expect(() => resolveControls(file, {}, { UNKNOWN: 'x' })).toThrow();
  });

  test('MAX_RETRIES needs an integer of at least 1 and MAX_FETCHES 0 stays valid', () => {
    expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
    expect(readConfig(resolveControls({ MAX_FETCHES: 0 })).maxFetches).toBe(0);
  });

  test('the scheduled path (empty inputs and advanced) equals the config defaults', () => {
    expect(resolveControls(file, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(file).map(([key, value]) => [key, String(value)])));
  });

  test('provider defaults and the SEC contact descriptor', () => {
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.requestSleep).toBe(1);
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(2);
    expect(config.holdingsPageSize).toBe(250);
    expect(config.historyPageSize).toBe(1000);
    expect(config.historyRange).toBe('max');
    expect(config.skipSprott).toBe(false);
    expect(config.skipYahoo).toBe(false);
    expect(config.edgarFallback).toBe(true);
    expect(config.storeRawDownloads).toBe(false);
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(config.secUa).toBe(file.SEC_UA);
    expect(read('scripts/update-data.ts')).not.toMatch(/example\.com/);
  });

  test('HISTORY_RANGE and filters flow through readConfig', () => {
    const config = readConfig(resolveControls({ HISTORY_RANGE: '5y', AUM: '100M:', TER: ':0.7', TICKERS: 'urnm, setm;URNJ' }));
    expect(config.historyRange).toBe('5y');
    expect(config.tickers).toEqual(['URNM', 'SETM', 'URNJ']);
    expect(config.terRange?.max).toBe(0.7);
    expect(config.aumRange?.min).toBe(100_000_000);
    expect(() => resolveControls({ TER: '1:2:3' })).toThrow();
  });
});

describe('config, README and --help stay in sync', () => {
  const doc = read('README.md');
  const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, unknown>;
  const tenor = (name: string) => name.match(/^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/);

  test('config keys equal CONTROL_NAMES and every value is a string', () => {
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
  });

  test('README controls table lists exactly the controls with their config defaults', () => {
    const section = doc.slice(doc.indexOf('### Update controls'), doc.indexOf('### Examples'));
    const rows = [...section.matchAll(/^\| `([A-Z0-9_]+)` \| (.*?) \|/gm)].map((match) => [match[1], match[2]]);
    expect(rows.map(([name]) => name).sort()).toEqual([...CONTROL_NAMES].sort());
    expect(doc).toContain('scripts/update-data.config.json');
  });

  test('--help text mentions every control', () => {
    for (const name of CONTROL_NAMES) {
      const match = tenor(name);
      expect(USAGE).toContain(match ? `${match[1]}_YTD|1Y|3Y|5Y|10Y` : name);
    }
  });
});

describe('README structure', () => {
  const doc = read('README.md');
  const headings = [...doc.matchAll(/^#{1,3} .+$/gm)].map((match) => match[0]);

  test('headings follow the standard order', () => {
    const order = [
      '# Sprott', '## Using Bun', '## Updating the static Sprott data', '### Data sources', '### Metrics and caveats',
      '### Update controls', '### Examples', '## TypeScript and verification', '## Brands table', '## Sibling applications', '## License',
    ];
    expect(headings.filter((heading) => order.includes(heading))).toEqual(order);
  });

  test('verification section lists the standard commands only', () => {
    const section = doc.slice(doc.indexOf('## TypeScript and verification'), doc.indexOf('## Brands table'));
    for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) {
      expect(section).toContain(command);
    }
    expect(doc).not.toMatch(/worklog|\.prompt\.txt|evidence\/|fixtures|research\/|config-docs/i);
  });
});

describe('update workflow', () => {
  const text = read('.github/workflows/update-data.yml');
  const inputSection = text.split('    inputs:')[1].split('\npermissions:')[0];
  const names = [...inputSection.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]);

  test('stays at or below the 25-input dispatch cap with a default-empty advanced JSON', () => {
    expect(names.length).toBeLessThanOrEqual(25);
    expect(names).toContain('advanced');
    expect(text).toContain("default: '{}'");
    for (const name of names.filter((item) => item !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  });

  test('runs weekly, resolves through resolveControls and never interpolates inputs', () => {
    expect(text).toContain("cron: '0 0 * * 0'");
    expect(text).not.toMatch(/^  push:/m);
    expect(text).toContain('toJSON(inputs)');
    expect(text).toContain('resolveControls(file, advanced, individual, protectedVars)');
    expect(text).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(text).not.toMatch(/\$\{\{\s*inputs\./);
    expect(text).toContain('bun install --frozen-lockfile');
    expect(text).not.toContain('bunx tsc');
  });

  test('output stays fixed to api/sprott with no output-dir control', () => {
    expect(text).not.toMatch(/OUTPUT_DIR|output_dir/i);
    expect(text.match(/git add (\S+)/g)).toEqual(['git add api/sprott']);
    expect(text.match(/api\/[\w-]+/g)!.every((path) => path === 'api/sprott')).toBe(true);
    expect(text).toContain('persist-credentials: false');
  });
});

describe('Sprott client substitutions', () => {
  const app = read('app.tsx');
  const html = read('index.html');
  const both = `${app}\n${html}`;

  test('every static API path points at ./api/sprott', () => {
    const paths = [...both.matchAll(/\.\/api\/[A-Za-z0-9_./-]+/g)].map((match) => match[0]);
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) expect(path.startsWith('./api/sprott/')).toBe(true);
    expect(both).not.toMatch(/\/api\/(?!sprott\/)[a-z]/i);
  });

  test('localStorage keys carry the Sprott prefix', () => {
    const keys = [...app.matchAll(/const [A-Z_]+_KEY = '([^']+)'/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) expect(key.startsWith('sprott-')).toBe(true);
    expect(html).toContain("localStorage.getItem('sprott-theme')");
  });

  test('attribution names the Sprott trust, CIK and site', () => {
    for (const source of [app, html]) {
      expect(source).toContain('SPROTT FUNDS TRUST, CIK 0001728683');
      expect(source).toContain('https://sprottetfs.com/');
    }
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
