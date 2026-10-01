/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  annualizedToTotal, batchSelection, buildMetrics, categoryLabel, decodeEntities, fundFilterReasons, holdingSymbol, htmlText,
  indicatedYield, inferDistributionFrequency, isCashHolding, isoDate, longDateToIso, mergeHistory, mergeOfficialDividends, nportMatches,
  numberOrNull, officialHoldings, officialReturns, parseAumRange, parseCatalog, parseChart, parseFundPage, parseFundTickerMap,
  parseHoldingsTable, parseNport, parseRange, priceReturns, readConfig, samePublishedContent, securityId, sortHoldings,
} from './update-data';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const menu = await fixture('catalog-menu.html');
const urnmHtml = await fixture('URNM-fund-page.html');
const rexcHtml = await fixture('REXC-fund-page.html');
const sgdmHtml = await fixture('SGDM-fund-page.html');
const catalog = parseCatalog(menu);
const urnm = parseFundPage(urnmHtml, 'URNM');
const rexc = parseFundPage(rexcHtml, 'REXC');
const sgdm = parseFundPage(sgdmHtml, 'SGDM');

describe('catalog from the official site menu (verified live 2026-10-01)', () => {
  test('13 funds, unique tickers, absolute fund pages with a trailing slash', () => {
    expect(catalog.map((f) => f.ticker)).toEqual(['COPJ', 'COPP', 'GBUG', 'LITP', 'METL', 'NIKL', 'REXC', 'SETM', 'SGDJ', 'SGDM', 'SLVR', 'URNJ', 'URNM']);
    expect(catalog.find((f) => f.ticker === 'URNM')).toEqual({
      ticker: 'URNM', name: 'Sprott Uranium Miners ETF', assetClass: 'Critical Materials',
      fundPage: 'https://sprottetfs.com/urnm-sprott-uranium-miners-etf/', nav: null, navDate: null,
    });
    for (const fund of catalog) expect(fund.fundPage).toMatch(/^https:\/\/sprottetfs\.com\/[a-z0-9]+-[a-z0-9-]+-etf\/$/);
  });
  test('asset class is the official menu group; entities are decoded; ticker is never taken from the name', () => {
    expect(Object.fromEntries(catalog.map((f) => [f.ticker, f.assetClass]))).toMatchObject({
      GBUG: 'Precious Metals', SLVR: 'Precious Metals', METL: 'Diversified Metals & Mining', REXC: 'Critical Materials', COPP: 'Critical Materials',
    });
    expect(catalog.find((f) => f.ticker === 'SLVR')?.name).toBe('Sprott Silver Miners & Physical Silver ETF');
    expect(categoryLabel('Sprott Diversified  Metals & Mining ETFs')).toBe('Diversified Metals & Mining');
    expect(categoryLabel('')).toBe('ETF');
  });
  test('non-fund links are ignored, duplicates with the same page collapse, conflicting pages fail', () => {
    const html = '<a class=" nav-link" href="/critical-materials/">Group ETFs</a><a class="sub-link" href="/insights/foo-etf/">x</a>'
      + '<a class="sub-link" href="/sprott-precious-metals-etfs/">y</a><a class="sub-link" href="/abcd-some-fund-etf">Some Fund ETF</a>'
      + '<a class="sub-link" href="/abcd-some-fund-etf/">Some Fund ETF</a>';
    expect(parseCatalog(html).map((f) => [f.ticker, f.assetClass, f.fundPage])).toEqual([['ABCD', 'Group', 'https://sprottetfs.com/abcd-some-fund-etf/']]);
    expect(() => parseCatalog('<a class="sub-link" href="/abcd-one-etf/">One</a><a class="sub-link" href="/abcd-two-etf/">Two</a>')).toThrow('Duplicate');
    expect(parseCatalog('<html>nothing</html>')).toEqual([]);
  });
  test('without the menu classes any fund link still works as a fallback', () => {
    expect(parseCatalog('<a href="https://sprottetfs.com/zzzz-sprott-test-etf/">Sprott Test ETF</a>')[0]).toMatchObject({ ticker: 'ZZZZ', assetClass: 'ETF' });
  });
});

describe('fund page parser: URNM fixture (as of 2026-09-30)', () => {
  test('header, key facts, fees and fund details', () => {
    expect(urnm).toMatchObject({
      ticker: 'URNM', asOfDate: '2026-09-30', nav: 47.63, navChange: -0.57, navChangePercent: -1.18, marketPrice: 47.5, premiumDiscount: -0.27,
      netExpense: 0.75, grossExpense: 0.75, exchange: 'NYSE Arca', benchmark: 'URNMX', isin: 'US85208P3038', cusip: '85208P303',
      inceptionDate: '2019-12-03', netAssets: 1838317077.32, netAssetsDate: '2026-09-30', sharesOutstanding: 38595000, holdingsCount: 26,
    });
  });
  test('NAV returns only (not market price or benchmark); unpublished tenors stay null, not zero', () => {
    expect(urnm.monthEnd).toEqual({ asOfDate: '2026-09-30', mo1: -16.37, mo3: -9.16, ytd: -13.32, yr1: -18.52, yr3: 3.44, yr5: 8.01, yr10: null, sinceInception: 25.01 });
    expect(urnm.quarterEnd?.asOfDate).toBe('2026-09-30');
  });
  test('full holdings table: 26 securities plus the cash row, symbols kept as published', () => {
    const rows = urnm.holdings!.rows;
    expect(urnm.holdings!.asOfDate).toBe('2026-09-30');
    expect(rows.length).toBe(27);
    expect(rows.filter((r) => !isCashHolding(r)).length).toBe(26);
    expect(rows[0]).toEqual({ Name: 'Cameco Corp.', Ticker: 'CCJ', Identifier: '2158684', Weight: '20.49', 'Market Value': '376658199.63', 'Shares Held': '4345889', 'Asset Category': '-', SEDOL: '2158684' });
    expect(rows[1].Ticker).toBe('U-U CN');
    expect(rows.find((r) => r.Name === 'CGN Mining Co. Ltd.')?.Ticker).toBe('1164 HK');
    expect(rows.at(-1)).toEqual({ Name: 'Cash Equivalent', Ticker: '-', Identifier: '-', Weight: '0.15', 'Market Value': '2659300.65', 'Shares Held': '-', 'Asset Category': 'Cash Equivalent', SEDOL: '' });
  });
  test('official distributions: "-" years are skipped, never a zero payment', () => {
    expect(urnm.distributions.present).toBe(true);
    expect(urnm.distributions.rows.map((d) => [new Date(d.epoch * 1000).toISOString().slice(0, 10), d.amount])).toEqual([
      ['2020-12-28', 1.1], ['2021-12-28', 4.82], ['2023-12-14', 1.75], ['2024-12-12', 1.28], ['2025-12-18', 1.74],
    ]);
    expect(inferDistributionFrequency(urnm.distributions.rows)).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
  });
  test('indicated yield is an estimate from the latest distribution and the market price', () => {
    expect(indicatedYield(1.74, 1, urnm.marketPrice)).toBe(3.66);
    expect(indicatedYield(null, 1, 47.5)).toBeNull();
  });
});

describe('fund page parser: REXC (young fund) and SGDM (older fund) fixtures', () => {
  test('REXC: month-end and quarter-end carry their own dates; since-inception under one year is not annualized', () => {
    expect(rexc.monthEnd?.asOfDate).toBe('2026-08-31');
    expect(rexc.quarterEnd?.asOfDate).toBe('2026-06-30');
    expect(rexc.monthEnd?.sinceInception).toBe(-11.27);
    expect(officialReturns(rexc.monthEnd, rexc.inceptionDate)).toMatchObject({ asOfDate: 'Aug 31 2026', mo1: 16.46, mo3: -19.01, ytd: null, yr1: null, sinceInception: null });
    expect(officialReturns(rexc.quarterEnd, rexc.inceptionDate)?.asOfDate).toBe('Jun 30 2026');
  });
  test('REXC: a placeholder distributions table means none, and unknown frequency stays "None"', () => {
    expect(rexc.distributions).toEqual({ present: true, rows: [] });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });
  test('official returns for an older fund keep the published since-inception figure', () => {
    expect(officialReturns(sgdm.monthEnd, sgdm.inceptionDate)).toMatchObject({ asOfDate: 'Sep 30 2026', yr10: 12.75, sinceInception: 10.15 });
  });
  test('SGDM: CUSIP printed with a space is normalized; 10 paid distributions, unpaid years skipped', () => {
    expect(sgdm.cusip).toBe('85210B102');
    expect(sgdm.isin).toBe('US85210B1026');
    expect(sgdm.distributions.rows.length).toBe(10);
    expect(sgdm.exchange).toBe('NYSE Arca');
  });
  test('a single distribution is not enough to infer a payment frequency', () => {
    expect(inferDistributionFrequency([{ epoch: 1766016000, amount: 2.05 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
  });
});

describe('parser safety', () => {
  test('wrong ticker or an unrecognized layout is rejected, never published', () => {
    expect(() => parseFundPage(urnmHtml, 'SGDM')).toThrow('ticker mismatch');
    expect(() => parseFundPage('<html><body>maintenance</body></html>', 'URNM')).toThrow('Unexpected Sprott fund page layout');
  });
  test('holdings must match the stated Number of Holdings (cash excluded)', () => {
    expect(officialHoldings(urnm)?.rows.length).toBe(27);
    expect(officialHoldings(urnm)?.source).toBe('sprottetfs.com fund page holdings table');
    expect(() => officialHoldings({ ...urnm, holdingsCount: 30 })).toThrow('page states 30');
    expect(officialHoldings({ ...urnm, holdingsCount: null })?.rows.length).toBe(27);
    expect(officialHoldings({ ...urnm, holdings: null })).toBeNull();
  });
  test('unexpected holdings columns or an incomplete row fail loudly', () => {
    const table = (head: string, row: string) => `<p class="update-date">As of 9/30/2026</p><table><tr>${head}</tr><tr>${row}</tr></table>`;
    const head = ['Security', 'Market Value', 'Symbol', 'SEDOL', 'Quantity', 'Weight'].map((h) => `<th>${h}</th>`).join('');
    const cell = (v: string) => `<td>${v}</td>`;
    expect(parseHoldingsTable(table(head, ['Acme', '$1,000.50', 'ACM CN', 'B000001', '10.00', '1.50%'].map(cell).join('')))?.rows[0])
      .toMatchObject({ Name: 'Acme', Ticker: 'ACM CN', 'Market Value': '1000.5', 'Shares Held': '10', Weight: '1.5' });
    expect(() => parseHoldingsTable(table('<th>Name</th>', '<td>x</td>'))).toThrow('Unexpected holdings columns');
    expect(() => parseHoldingsTable(table(head, cell('Acme') + cell('$1')))).toThrow('Unexpected holdings row');
    expect(() => parseHoldingsTable(table(head, ['Acme', '', 'ACM', 'B1', '1', '1%'].map(cell).join('')))).toThrow('without value or weight');
  });
  test('negative cash, zero weight and placeholder symbols are preserved faithfully', () => {
    const head = ['Security', 'Market Value', 'Symbol', 'SEDOL', 'Quantity', 'Weight'].map((h) => `<th>${h}</th>`).join('');
    const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const html = `<p class="update-date">As of 9/30/2026</p><table><tr>${head}</tr>${row(['Tiny Corp.', '$3.00', 'N/A', '', '0.00', '0.00%'])}${row(['Cash Equivalent', '$-303,871.54', '', '', '$-303,871.54', '0.02%'])}</table>`;
    const rows = parseHoldingsTable(html)!.rows;
    expect(rows[0]).toMatchObject({ Ticker: '-', Weight: '0', 'Shares Held': '0', Identifier: '-' });
    expect(rows[1]).toMatchObject({ 'Market Value': '-303871.54', 'Shares Held': '-', 'Asset Category': 'Cash Equivalent' });
  });
  test('symbols keep exchange suffixes and class markers; placeholders become empty', () => {
    expect(holdingSymbol(' aya  cn ')).toBe('AYA CN');
    expect(holdingSymbol('U/U')).toBe('U/U');
    for (const empty of ['', '-', 'n/a', '$2,659,300.65', null]) expect(holdingSymbol(empty)).toBe('');
  });
  test('holdings sort by weight then name deterministically', () => {
    const rows = [{ Name: 'B', Weight: '1' }, { Name: 'A', Weight: '1' }, { Name: 'C', Weight: '2' }, { Name: 'D', Weight: '' }];
    expect(sortHoldings(rows).map((r) => r.Name)).toEqual(['C', 'A', 'B', 'D']);
  });
  test('dates, ids and text helpers', () => {
    expect(longDateToIso('September 30, 2026')).toBe('2026-09-30');
    expect(longDateToIso('Sept 3, 2026')).toBe('2026-09-03');
    expect(longDateToIso('9/30/2026')).toBe('2026-09-30');
    expect(longDateToIso('Smarch 3, 2026')).toBeNull();
    expect(longDateToIso('')).toBeNull();
    expect(securityId('CUSIP: 85210B 102', 'CUSIP', /^[A-Z0-9]{9}$/)).toBe('85210B102');
    expect(securityId('CUSIP: 12', 'CUSIP', /^[A-Z0-9]{9}$/)).toBe('');
    expect(htmlText('<h4>  Tom &amp; Jerry&nbsp;Miners&trade; <br/> &#8211; </h4>')).toBe('Tom & Jerry Miners –');
    expect(decodeEntities('&unknown; &#x41;')).toBe('&unknown; A');
    expect(isoDate('8/31/2026 12:00:00 AM')).toBe('2026-08-31');
  });
  test('missing numbers stay null; a real zero stays zero', () => {
    for (const blank of ['', '--', '-', 'N/A']) expect(numberOrNull(blank)).toBeNull();
    expect(numberOrNull('0.00')).toBe(0);
    expect(numberOrNull('-$0.57')).toBe(-0.57);
    expect(numberOrNull('$1,838,317,077.32')).toBe(1838317077.32);
  });
});

describe('distribution merge, metrics and shared financial math', () => {
  test('official rows are authoritative; only later payments are added from other sources', () => {
    const day = 86_400;
    const official = [{ epoch: 1000 * day, amount: 1 }, { epoch: 1365 * day, amount: 2 }];
    const later = [{ epoch: 1000 * day, amount: 9 }, { epoch: 1300 * day, amount: 8 }, { epoch: 1730 * day, amount: 3 }];
    expect(mergeOfficialDividends(official, later)).toEqual([{ epoch: 1000 * day, amount: 1 }, { epoch: 1365 * day, amount: 2 }, { epoch: 1730 * day, amount: 3 }]);
    expect(mergeOfficialDividends([], later).length).toBe(3);
  });
  test('metrics: official first, derived second; cumulative from annualized; zero CAGR stays zero', () => {
    const derived = { asOfDate: '2026-09-30', ytd: 1, yr1: 2, cagr3y: 3, cagr5y: 4, cagr10y: 5, siAnn: 6, mo1: 7, qtd: 8 };
    const m = buildMetrics({ ytd: 10, yr1: 20, yr3: null, yr5: 0, yr10: null, sinceInception: null }, derived, null, 2.5);
    expect(m).toMatchObject({ ytd: 10, tr1y: 20, cagr3y: 3, cagr5y: 0, tr5y: 0, cagr10y: 5, siAnn: 6, secYield: null, dividendYield: 2.5, dividendYieldText: '2.50%' });
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(0, 3)).toBe(0);
  });
  test('Yahoo adjusted close is rounded at parse time; dividend events are parsed', () => {
    const p = parseChart({ chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ close: [40.123456789], volume: [10] }], adjclose: [{ adjclose: [40.129991] }] }, events: { dividends: { x: { date: 1700000000, amount: 0.5 } } } }] } });
    expect(p.days[0].adjClose).toBe(40.13);
    expect(p.dividends.length).toBe(1);
  });
  test('short history cannot invent multi-year returns', () => {
    const days = [{ date: '2026-01-01', close: 10, adjClose: 10, volume: 0 }, { date: '2026-09-25', close: 11, adjClose: 11, volume: 0 }];
    expect(priceReturns(days, new Date('2026-09-25')).cagr3y).toBeNull();
  });
  test('history merges instead of truncating the past', () => {
    expect(mergeHistory([{ Date: 'Jan 01 2020', Close: '10', 'Adj Close': '10', Volume: '0' }], [{ date: '2026-09-25', close: 11, adjClose: 11, volume: 1 }]).length).toBe(2);
  });
  test('timestamps and key order never rewrite published data', () => {
    expect(samePublishedContent('{"source":{"generatedAt":"old","x":1},"catalogReadAt":"old"}', { catalogReadAt: 'new', source: { x: 1, generatedAt: 'new' } })).toBe(true);
    expect(samePublishedContent('{"x":1}', { x: 2 })).toBe(false);
  });
});

describe('configuration, filters and cursor', () => {
  test('defaults; an explicit zero differs from unset; SPROTT_ alias wins', () => {
    expect(readConfig({}).requestSleep).toBe(1);
    expect(readConfig({ REQUEST_SLEEP: '0' }).requestSleep).toBe(0);
    expect(readConfig({ MAX_RETRIES: '0' }).maxRetries).toBe(0);
    expect(readConfig({ TICKERS: 'URNM', SPROTT_TICKERS: 'sgdm, slvr' }).tickers).toEqual(['SGDM', 'SLVR']);
    expect(readConfig({ SKIP_SPROTT: 'yes' }).skipSprott).toBe(true);
    expect(readConfig({}).skipSprott).toBe(false);
    expect(readConfig({}).secUa).toBe('daggerok Sprott ETF feed (https://github.com/daggerok/Sprott)');
  });
  test('ranges are strict and AUM supports suffixes and presets', () => {
    expect(parseRange(':', 'TER')).toBeUndefined();
    expect(parseRange(':0.3%', 'TER')).toEqual({ min: undefined, max: 0.3 });
    for (const bad of ['15', '1:2:3', 'a:2', '4:1']) expect(() => parseRange(bad, 'TER')).toThrow();
    expect(parseAumRange('10M:2B')).toEqual({ min: 1e7, max: 2e9 });
    expect(parseAumRange('large')).toEqual({ min: 1e10, max: undefined });
  });
  test('filters use the published figures; unavailable values never satisfy a range', () => {
    const cfg = readConfig({ PERFORMANCE_3Y: '2:4', TOTAL_RETURN_3Y: '5:20', DIVIDEND_YIELD: '1:5', AUM: '1B:', TER: ':0.8' });
    const ok = { ticker: 'X', aumValue: 2e9, terValue: 0.75, metrics: { dividendYield: 3, cagr3y: 3, tr3y: 10 } };
    expect(fundFilterReasons(ok, cfg)).toEqual([]);
    expect(fundFilterReasons({ ...ok, metrics: { ...ok.metrics, dividendYield: null } }, cfg)).toEqual(['DIVIDEND_YIELD']);
    expect(fundFilterReasons({ ...ok, aumValue: 5e8, terValue: 0.9 }, cfg)).toEqual(['AUM', 'TER']);
    expect(fundFilterReasons({ ...ok, ticker: 'Y' }, readConfig({ TICKERS: 'X' }))).toEqual(['TICKERS']);
  });
  test('SEC_YIELD is not a Sprott control (the site publishes no 30-day SEC yield)', () => {
    expect(() => readConfig({ SEC_YIELD: '1:2' })).not.toThrow();
    expect(readConfig({ SEC_YIELD: '1:2' })).not.toHaveProperty('secYieldRange');
  });
  test('bounded queue rotates deterministically after filtering', () => {
    expect(batchSelection(catalog, readConfig({ TICKERS: 'URNM SGDM SLVR', MAX_FETCHES: '2' }), 'SGDM').map((f) => f.ticker)).toEqual(['SLVR', 'URNM']);
    expect(batchSelection(catalog, readConfig({ TICKERS: 'URNM SGDM', MAX_FETCHES: '0' }), 'URNM').map((f) => f.ticker)).toEqual(['SGDM', 'URNM']);
  });
});

describe('SEC N-PORT fallback (fixture only: data.sec.gov answered HTTP 403 from the development environment)', () => {
  const xml = '<edgarSubmission><genInfo><regName>SPROTT FUNDS TRUST</regName><regCik>1728683</regCik><seriesName>Sprott Uranium Miners ETF</seriesName><seriesId>S000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Cameco Corp</name><cusip>13321L108</cusip><pctVal>5</pctVal><valUSD>50</valUSD><balance>2</balance><assetCat>EC</assetCat></invstOrSec></edgarSubmission>';
  const fund = catalog.find((f) => f.ticker === 'URNM')!;
  test('ticker map field order independent', () => {
    expect(parseFundTickerMap({ fields: ['symbol', 'classId', 'cik', 'seriesId'], data: [['URNM', 'C1', 1728683, 'S000001']] }).get('URNM')).toEqual({ cik: '0001728683', seriesId: 'S000001', classId: 'C1' });
  });
  test('N-PORT extraction and series isolation inside the trust', () => {
    const p = parseNport(xml);
    expect(p.holdings[0].Identifier).toBe('13321L108');
    expect(nportMatches(fund, p, { cik: '0001728683', seriesId: 'S000001', classId: 'C1' })).toBe(true);
    expect(nportMatches(fund, p, { cik: '0001728683', seriesId: 'S000002', classId: 'C1' })).toBe(false);
    expect(nportMatches(fund, p)).toBe(true);
    expect(nportMatches({ ...fund, name: 'Sprott Junior Uranium Miners ETF' }, p)).toBe(false);
  });
});

describe('web app parity guards', () => {
  test('frequency display placeholder and brand-specific storage keys', async () => {
    const app = await readFile(new URL('../app.tsx', import.meta.url), 'utf8');
    expect(app).toContain("if (!normalized || normalized === '-') return '00 - None';");
    expect(app).toContain("const INDEX_URL = './api/sprott/index.json';");
    expect(app).toMatch(/const THEME_KEY = 'sprott-theme';/);
    expect(app).not.toMatch(/aberdeen|abrdn/i);
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>Sprott ETFs</title>');
    expect(html).not.toMatch(/aberdeen|abrdn/i);
  });
});

// Isolated end-to-end fixture runner: real writer/main, mocked public transport,
// temporary API root. No network requests, no mutation of committed data.
test('offline pipeline: publication, byte-identical rerun, outage retention, fresh filters and cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sprott-test-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await cp(new URL('update-data.ts', import.meta.url), join(dir, 'scripts/update-data.ts'));
    await Bun.write(join(dir, 'fixture.json'), JSON.stringify({ menu, pages: { URNM: urnmHtml, REXC: rexcHtml, SGDM: sgdmHtml } }));
    await Bun.write(join(dir, 'runner.ts'), `import {main} from './scripts/update-data';
const p=await Bun.file('./fixture.json').json();let fail=false;
const chart={chart:{result:[{meta:{fullExchangeName:'NYSEArca',regularMarketPrice:47.5,regularMarketTime:1790800000,firstTradeDate:1575383400},timestamp:[1790000000,1790086400],indicators:{quote:[{close:[47.1,47.5],volume:[100,200]}],adjclose:[{adjclose:[47.1234,47.5]}]},events:{dividends:{d:{date:1790086400,amount:0.5}}}}]}};
globalThis.fetch=async(input)=>{const u=String(input);if(fail)return new Response('denied',{status:403});
if(u.startsWith('https://query1.finance.yahoo.com/'))return Response.json(chart);
if(u==='https://sprottetfs.com/')return new Response(p.menu);
for(const [t,html] of Object.entries(p.pages))if(u.includes('/'+t.toLowerCase()+'-'))return new Response(html);
return new Response('',{status:404});};
const env={REQUEST_SLEEP:'0',MAX_RETRIES:'0',EDGAR_FALLBACK:'0',TICKERS:'URNM REXC SGDM'};
const hash=async()=>{const g=new Bun.Glob('api/**/*.json');const r={};for await(const f of g.scan('.'))r[f]=await Bun.file(f).text();return JSON.stringify(Object.entries(r).sort());};
await main(env);if(process.exitCode)throw Error('first run failed');const first=await hash();
const index=await Bun.file('api/sprott/index.json').json();if(index.funds.length!==3)throw Error('index lacks funds');
const meta=await Bun.file('api/sprott/funds/URNM/meta.json').json();
if(meta.nav.value!==47.63||meta.aum.value!==1838317077.32||meta.holdings.totalRows!==27)throw Error('URNM meta wrong');
if(meta.distributions.rows.length!==6||meta.distributions.rows[4][0]!=='12/18/2025')throw Error('distributions wrong');
const rexc=await Bun.file('api/sprott/funds/REXC/meta.json').json();
if(rexc.returns.monthEnd.sinceInception!==null||rexc.returns.monthEnd.asOfDate!=='Aug 31 2026')throw Error('REXC returns wrong');
await main(env);if(first!==await hash())throw Error('Not idempotent');
fail=true;await main(env);if(first!==await hash())throw Error('Outage changed published files');
fail=false;await main({...env,AUM:'5B:'});if(first!==await hash())throw Error('Fresh filter did not preserve excluded funds');
await main({...env,MAX_FETCHES:'1'});const state=await Bun.file('api/sprott/update-state.json').json();if(state.cursor!=='REXC')throw Error('Cursor incorrect: '+state.cursor);
await main(env);if(await Bun.file('api/sprott/update-state.json').exists())throw Error('Full run did not reset cursor');
await main({...env,SKIP_YAHOO:'1',SKIP_SPROTT:'1'});if(first!==await hash())throw Error('Offline published-data run changed files');`);
    const child = Bun.spawn([process.execPath, 'runner.ts'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
    expect({ code: await child.exited, stderr: /Error:|error:/.test(stderr) ? stderr : '', stdout: stdout.includes('NaN') ? 'NaN' : '' }).toEqual({ code: 0, stderr: '', stdout: '' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);
