# Sprott

One of the app's features lets you select Sprott ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size. Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/sprott` static feed (the sprottetfs.com fund navigation and official fund pages - key facts, expenses, performance and distribution tables, plus the "Download All Holdings" CSV - with SEC EDGAR N-PORT-P as a holdings fallback and Yahoo Finance daily market-price history/dividend fallbacks) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Sprott#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The app is live at <https://daggerok.github.io/Sprott/> (GitHub Pages, deployed from the `main` branch).

## Updating the static Sprott data

Run the updater with Bun (the script is directly executable):

```bash
./scripts/update-data.ts
```

Run `./scripts/update-data.ts --help` to print every configuration variable with its default and usage examples.

The **Update Sprott ETF data** GitHub Actions workflow runs on Sunday 00:00 UTC and on demand, installs with a frozen lockfile, runs the updater and commits only changed `api/sprott` files. No changes means no commit. A failed updater keeps previously published data in place. Checkout never persists credentials, and the push step uses the runner token only at runtime.

[scripts/update-data.config.json](scripts/update-data.config.json) holds the defaults for every control. It is loaded relative to the updater, not the current working directory. Only a missing file permits built-in fallbacks; malformed or unreadable configuration fails. All supplied filters use AND logic.

Precedence, lowest to highest: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable or process environment. A blank input inherits the file value, `advanced` can set a key to an empty string on purpose, and a nonblank input wins even when it is `0` or `false`. An explicitly set environment variable overrides everything, even when empty (`SPROTT_<NAME>` is accepted for every control, plus the legacy `SPROTT_LIMIT` and `HISTORICAL_PAGE_SIZE`). Invalid values fail with a clear message instead of falling back silently.

The workflow exposes 24 controls as optional string inputs plus `advanced`, a JSON object that reaches every control without its own input:

```yaml
advanced: '{"SEC_UA":"ops contact","VERBOSE":"true","SKIP_SPROTT":"true"}'
```

Dependabot is monthly for Bun and GitHub Actions.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Sprott ETFs) | The [US sitemap](https://sprottetfs.com/sitemap.xml) discovers the official fund pages, and the fund-navigation block rendered inside the first healthy pages supplies the tickers and names; sitemap slugs plus published identities are the fallback, and the previously published catalog is retained if even that fails. |
| Holdings per fund | The official **Download All Holdings** CSV embedded in each fund page (e.g. [URNM](https://sprottetfs.com/urnm-sprott-uranium-miners-etf/)); the same page's holdings table is parsed when the CSV is absent. |
| Key facts, expenses, distributions | The same fund pages: NAV/pricing block, key-facts cells (ISIN, CUSIP, listing exchange, benchmark, inception), the fee table and `#DistributionsData`. |
| Returns | The official month-end/quarter-end average annual total-return tables on each fund page; missing metrics are derived from Yahoo adjusted closes at the same reporting date. |
| Daily history, dividends | Yahoo Finance chart prices, adjusted closes and dividend events. |
| Fallback | SEC EDGAR N-PORT-P holdings (Sprott-focused trusts, CIK `0001728683`, exact series matching) + previously published data as the last resort. |

The published snapshot contains **13 funds, 736 holdings rows and 14,111 daily-history rows** (e.g. URNM 27 holdings / 1,715 history rows, SGDM 49 / 3,073, SGDJ 32 / 2,894). Unknown facts are unavailable, never invented as zero.

### Metrics and caveats

Sprott publishes no 30-day SEC yield, so `secYield` renders a dash placeholder and `secYieldKind` records `not published`; the catalog column stays honest for every fund. The history series is **market price, not official NAV**: `historySource` states Yahoo daily market-price closes/adjusted closes, and the derived figures are **not published standardized NAV returns**. Returns that a fund page publishes officially are used as published; only missing metrics are derived. The holdings CSV is the primary source and the page's holdings table is the fallback, so a fund page that drops the download still updates.

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official or coverage-checked derived YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published or coverage-checked derived annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized when date/age/coverage support it (not young cumulative SI) -> *SI Ann.*
- `dividendYield` - indicated rate: latest positive distribution × payments per year ÷ market price
- `secYield` - a dash placeholder: Sprott publishes none
- `returnsBasis` - mandatory non-empty text saying how the returns were computed: official sprottetfs.com NAV total returns with gaps derived from Yahoo adjusted closes, or Yahoo adjusted market-price returns (an estimate, not official NAV)
- `performanceAsOf` - mandatory ISO `YYYY-MM-DD` date the returns are as of: the month-end performance table date on the fund page, or the last Yahoo close date when derived; not the NAV date; `null` only when truly unknown

Both fields are the last two keys of each `metrics` object.

Unavailable data is never published as zero, and no tickers are excluded.

### Update controls

Defaults below are exactly the values in `scripts/update-data.config.json`; blank Actions inputs do not override them.

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch evaluation size: positive resumes the scoped cursor in `api/sprott/update-state.json`; `0` is a full selected pass and resets the cursor. |
| `REQUEST_SLEEP` | `1` | Minimum seconds between outgoing request starts on each worker lane, including retries. Every worker paces itself, so the overall rate is about `CONCURRENCY / REQUEST_SLEEP` requests per second. |
| `CONCURRENCY` | `2` | Parallel fund workers (worker pool), each with its own request lane. With `REQUEST_SLEEP=0` requests are not paced. |
| `TICKERS` | all | Space/comma/semicolon allowlist, e.g. `URNM URNJ SETM`; empty means all funds. |
| `AUM` | `:` | Total net assets range: USD amounts or K/M/B/T suffixes; nano/micro/small/mid/large presets; inclusive min:max. |
| `TER` | `:` | Net total expense ratio range in % (strict min:max). |
| `DIVIDEND_YIELD` | `:` | Indicated distribution-yield range in %, min:max; missing values do not pass an active range. |
| `SEC_YIELD` | `:` | 30-day SEC-yield range in %, min:max; Sprott publishes none, so an active range filters everything out. |
| `HOLDINGS_PAGE_SIZE` | `250` | Holdings rows per JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Daily history rows per JSON page |
| `MAX_RETRIES` | `2` | Retries after the initial request, integer >= 1 (transient HTTP/network failures only) |
| `HISTORY_RANGE` | `max` | Yahoo daily history range: `max` or `Ny` (e.g. `5y`); merges with previously published history |
| `STORE_RAW_DOWNLOADS` | `false` | Keep raw provider payload snapshots beside the feed (config/`advanced` only) |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC EDGAR contact User-Agent, redacted in logs; the Actions variable `SEC_UA` overrides it when nonblank. Do not put credentials here. |
| `SKIP_YAHOO` | `false` | Skip Yahoo history and dividends; retain published data |
| `SKIP_SPROTT` | `false` | Skip sprottetfs.com pages; retain published data (config/`advanced` only) |
| `EDGAR_FALLBACK` | `true` | SEC N-PORT-P holdings fallback for funds without a usable holdings sheet |
| `VERBOSE` | `false` | Provider/fallback/retry detail; the normal compact fund reporter always retains real zero/false and omits missing fields (config/`advanced` only) |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD` | `:` | YTD performance percent min:max (3Y/5Y/10Y annualized) |
| `PERFORMANCE_1Y` | `:` | 1Y performance percent min:max |
| `PERFORMANCE_3Y` | `:` | 3Y annualized performance percent min:max |
| `PERFORMANCE_5Y` | `:` | 5Y annualized performance percent min:max |
| `PERFORMANCE_10Y` | `:` | 10Y annualized performance percent min:max |
| `TOTAL_RETURN_YTD` | `:` | YTD cumulative total return percent min:max |
| `TOTAL_RETURN_1Y` | `:` | 1Y cumulative total return percent min:max |
| `TOTAL_RETURN_3Y` | `:` | 3Y cumulative total return percent min:max |
| `TOTAL_RETURN_5Y` | `:` | 5Y cumulative total return percent min:max |
| `TOTAL_RETURN_10Y` | `:` | 10Y cumulative total return percent min:max |

`TICKERS` combines with AUM, TER, yield and return filters using AND logic; it does not override them. Funds not selected for a successful update keep their prior published metadata and data files.

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="URNM URNJ SETM" ./scripts/update-data.ts
AUM="100M:" TER=":0.7" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

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
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
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
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
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
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
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

[MIT - same as all sibling ETF repositories.](./LICENSE)

Sprott® and the fund names/tickers referenced here are trademarks of Sprott Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Sprott Inc. All data is reproduced from Sprott's own public fund pages and downloads, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
