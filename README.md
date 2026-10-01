# Sprott

One of the app's features lets you select Sprott ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/sprott` static feed (official sprottetfs.com fund pages: catalog, NAV, market price, premium/discount, expenses, net assets, full portfolio holdings, month-/quarter-end NAV performance and distributions; SEC EDGAR N-PORT-P holdings fallback; Yahoo Finance market-price history and dividend fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Sprott#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The application URL will be <https://daggerok.github.io/Sprott/>; GitHub Pages deployment is pending (the site currently answers HTTP 404). The repository ships the updater, not a published data snapshot: run the **Update Sprott ETF data** workflow (or `bun scripts/update-data.ts`) once to generate `api/sprott` before the app has data to show.

## Updating the static Sprott data

Run the updater with Bun:

```bash
bun test
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print the effective configuration and usage examples. The updater has **no runtime dependencies**.

Defaults live next to the updater in [`scripts/update-data.config.json`](./scripts/update-data.config.json) (every control as a string). Precedence: file defaults < `advanced` JSON < nonblank inputs < protected Actions variable or environment. With no overrides the updater refreshes the entire catalog discovered on sprottetfs.com (`MAX_FETCHES=0`, `TICKERS=""`), keeps published data when a provider fails, and writes only meaningful changes. It does not skip fetching a fund merely because yesterday's data exists. Unchanged reruns do not create timestamp-only diffs.

The **Update Sprott ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic. It runs Sundays at **00:00 UTC** and on manual dispatch, with no push trigger. It writes only `api/sprott`.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all Sprott ETFs) | The fund links in the [sprottetfs.com](https://sprottetfs.com/) site menu, grouped under the menu headings "Critical Materials", "Precious Metals" and "Diversified Metals & Mining" (the asset class shown in the app). Each fund page lives at `https://sprottetfs.com/<ticker>-<name>-etf/`, for example [URNM](https://sprottetfs.com/urnm-sprott-uranium-miners-etf/). The 13 funds verified on 2026-10-01 are COPJ, COPP, GBUG, LITP, METL, NIKL, REXC, SETM, SGDJ, SGDM, SLVR, URNJ and URNM. |
| Fund facts, NAV, market price | Server-rendered HTML of the fund page: NAV, market price (the 4 p.m. ET bid/ask midpoint), premium/discount, net total expense ratio, total annual fund operating expenses, total net assets (exact), listing exchange, benchmark index, ISIN, CUSIP and inception date, all as of the date printed above the NAV block. No JavaScript, API key or WAF workaround is needed. |
| Full securities holdings | The "Holdings" table of the same page (Security, Market Value, Symbol, SEDOL, Quantity, Weight, with its own as-of date). The table is accepted only when its security count (cash excluded) equals the page's own "Number of Holdings". The page's "Download All Holdings" CSV is the same table. |
| NAV total returns | The "Month-End Performance" and "Quarter-End Performance" tables, Net Asset Value row only (market-price and benchmark rows are ignored). Each table keeps its own published "As of" date, which can differ. |
| Distributions | The page's distribution table (ex-date and total distribution). Payments published as `-` are skipped and never stored as zero. |
| Market-price history | Yahoo Finance public chart API `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}` with daily bars and dividend events. Adjusted close is rounded to 2 decimals. Sprott publishes no daily NAV history, so these are **market-price estimates, not official NAV history rows**. |
| Holdings fallback | SEC fund-ticker/series map, series Atom feed, registrant submissions and N-PORT-P XML for SPROTT FUNDS TRUST (CIK 0001728683, per the research recorded in `.worklog.txt`); each filing must match the requested series (or the exact normalized fund name). Used only when the page's holdings table is missing or fails validation. |
| Last resort | Existing committed `meta.json`, holdings and history pages. An unavailable source must not erase published data. |

### Metrics and caveats

Each fund carries the same derived `metrics` object as the sibling sites:

- `ytd` / `tr1y` - official NAV returns when published; gaps derived from Yahoo adjusted closes at the same reporting date
- `cagr3y` / `cagr5y` / `cagr10y` - official average annual NAV returns first
- `tr3y` / `tr5y` / `tr10y` - `(1 + CAGR)^n - 1`; a real zero stays zero
- `siAnn` - official since-inception return, or adequately covered Yahoo history; a since-inception figure for a fund younger than one year is cumulative on the Sprott page, so it is not shown as annualized
- `dividendYield` - indicated: latest official distribution x annual payment frequency / market price (an estimate from the market price, not an official figure)

Unavailable values stay null and are never shown as zero; only a published zero is zero.

**Known limitations**

- **No 30-day SEC yield:** Sprott does not publish one, so the SEC yield stays unavailable and there is no `SEC_YIELD` control.
- **Distribution frequency:** inferred from the paid official ex-dates. Sprott funds pay a year-end distribution, so a fund with at least two payments shows Annually, and a fund with exactly one payment shows Unknown (no yield is indicated for it); a fund with none shows None. This is an inference, not a published schedule.
- **Newer funds:** REXC launched on 2026-04-14. Its performance tables show `--` for tenors it has not reached; those stay null. Month-end and quarter-end tables can carry different dates (8/31/2026 and 6/30/2026 on 2026-10-01).
- **Symbols:** holdings tickers are kept exactly as Sprott prints them, including exchange suffixes such as `AYA CN` or `1164 HK`, so the same company can appear under different symbols in different funds. The cash row has no symbol and no share count.
- **Premium/discount and market price:** the page value is the 4 p.m. ET bid/ask midpoint on the NAV date, not a closing trade price. When the page omits them, the updater falls back to the Yahoo price and computes a premium only from values with the same date.
- **SEC live access:** during development data.sec.gov and sec.gov/files returned HTTP 403 from the build environment. The fallback is implemented and fixture-tested (including wrong-series rejection), but live SEC retrieval has not been validated here. The CIK is taken from the recorded research and not re-verified live.
- **Network/CI:** site markup, throttling and CDN availability can change. Conservative request pacing and bounded retries apply. Tests are offline; a passing test suite does not imply every live provider is reachable.
- **Client dependencies:** like the sibling UI, the browser loads Tailwind/Babel from CDNs and needs network access for them. No server backend or runtime package installation is required for the app.

### Update controls

Precedence: `scripts/update-data.config.json` defaults < Actions `advanced` JSON < nonblank individual inputs < protected Actions variable or environment. The same `resolveControls` runs locally and in Actions. Locally, environment variables override the file and `SPROTT_<NAME>` overrides the unprefixed name.

Actions exposes 24 individual inputs plus `advanced`, respecting GitHub's 25-input limit. `SEC_UA`, `STORE_RAW_DOWNLOADS` and `VERBOSE` are available through `advanced` and the config file. Unknown keys, invalid ranges, non-scalar values and newline injection are rejected before any request. No credentials belong in the config file.

`SEC_UA` can be supplied by the protected repository Actions variable `SEC_UA`; when nonblank it wins over every other layer and is never printed or exposed as an input. The config default is a non-personal repository descriptor.

Blank individual inputs mean **inherit**, not clear. To clear a file's ticker restriction in Actions, use `{"TICKERS":""}` in `advanced`.

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size; positive resumes cursor, 0 refreshes the selected universe and resets cursor. |
| `REQUEST_SLEEP` | `1` | Seconds between request starts per pacing lane, retries included. |
| `CONCURRENCY` | `2` | Parallel fund workers; each has its own paced request lane. |
| `AUM` | `:` | Total net assets min:max in USD; K/M/B/T or nano/micro/small/mid/large preset. |
| `TER` | `:` | Total annual fund operating expense percent min:max. |
| `DIVIDEND_YIELD` | `:` | Indicated dividend yield percent min:max. |
| `TICKERS` | empty (all) | Ticker allowlist separated by spaces, commas or semicolons; empty means all. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows per holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows per market-price history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the first request; 0 disables retries. |
| `HISTORY_RANGE` | `max` | Yahoo daily history range: max or Ny (e.g. 5y); preserves prior history. |
| `STORE_RAW_DOWNLOADS` | `false` | Save source snapshots under api/sprott/raw. |
| `SEC_UA` | `daggerok Sprott ETF feed (https://github.com/daggerok/Sprott)` | SEC User-Agent; supply a real identifying contact via the protected `SEC_UA` variable or env. |
| `SKIP_YAHOO` | `false` | Skip Yahoo history and dividends; retain published data. |
| `SKIP_SPROTT` | `false` | Use the published catalog and details; only fallback providers are called. |
| `EDGAR_FALLBACK` | `true` | Enable SEC N-PORT holdings fallback; never use an unrelated series. |
| `VERBOSE` | `false` | Print per-request failures and fallback diagnostics. |
| `PERFORMANCE_YTD` | `:` | Year-to-date NAV return percent min:max. |
| `PERFORMANCE_1Y` | `:` | 1-year NAV return percent min:max. |
| `PERFORMANCE_3Y` | `:` | 3-year average annual NAV return percent min:max. |
| `PERFORMANCE_5Y` | `:` | 5-year average annual NAV return percent min:max. |
| `PERFORMANCE_10Y` | `:` | 10-year average annual NAV return percent min:max. |
| `TOTAL_RETURN_YTD` | `:` | Cumulative YTD return percent min:max. |
| `TOTAL_RETURN_1Y` | `:` | Cumulative 1-year return percent min:max. |
| `TOTAL_RETURN_3Y` | `:` | Cumulative 3-year return percent min:max (derived from the annualized figure). |
| `TOTAL_RETURN_5Y` | `:` | Cumulative 5-year return percent min:max (derived from the annualized figure). |
| `TOTAL_RETURN_10Y` | `:` | Cumulative 10-year return percent min:max (derived from the annualized figure). |

`TICKERS` combines with all other filters. Excluded and failed funds keep their previous published files and index entries. A bounded batch counts selected funds, follows deterministic ticker order, and does not advance its cursor if the batch has failures. A successful full pass removes the cursor.

### Examples

```bash
# Entire catalog, using committed defaults
bun scripts/update-data.ts

# Primary runtime controls
TICKERS="URNM SGDM SLVR" CONCURRENCY=2 bun scripts/update-data.ts
MAX_FETCHES=3 bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
STORE_RAW_DOWNLOADS=1 VERBOSE=1 bun scripts/update-data.ts
```

Manual Actions `advanced` example (leave individual inputs blank to inherit):

```json
{"CONCURRENCY":2,"TICKERS":"URNM SGDM SLVR","VERBOSE":true,"STORE_RAW_DOWNLOADS":false}
```

Use your real identifying contact in `SEC_UA` (environment or the protected Actions variable) when running SEC automation. A User-Agent change does not guarantee that an execution environment's HTTP 403 will disappear.

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` also covers the config file, `--help`, README controls and workflow checks (`scripts/config-docs.test.ts`). Optionally check the UI bundle with `bun build app.tsx --outfile=/dev/null`. These do **not** perform semantic TypeScript checking. Do not add `typescript` or a `tsconfig.json`.

The UI template is **daggerok/Aberdeen @ e6e244b625b978cb1b781341f2a00b79484ffc01** (the sibling that already carries the shared header ETF-count popover); only brand names, storage keys, API paths and source/provenance wording differ.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) (deployment pending) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) (deployment pending) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as the sibling ETF repositories.](./LICENSE)

Sprott, Sprott ETFs and the fund names/tickers referenced here are trademarks of their respective owners. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Sprott Inc., Sprott Asset Management USA, Inc. or ALPS Advisors, Inc. Data is obtained from the official public fund site, public SEC filings when accessible, and Yahoo Finance for research purposes. All other trademarks, including index names, belong to their respective owners.
