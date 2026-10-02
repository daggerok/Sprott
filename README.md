# Sprott

One of the app's features lets you select Sprott ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size. Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/sprott` static feed (the sprottetfs.com fund navigation and official fund pages — key facts, expenses, performance and distribution tables, plus the "Download All Holdings" CSV — with SEC EDGAR N-PORT-P as a holdings fallback and Yahoo Finance daily market-price history/dividend fallbacks) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Sprott#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The deployment target is <https://daggerok.github.io/Sprott/>. Deployment is pending: this feature must first be merged to `main` by the owner and GitHub Pages enabled with GitHub Actions. The prepared Pages workflow never deploys an unmerged feature branch.

## Updating the static Sprott data

Run the updater with Bun:

```bash
bun test scripts/update-data.test.ts
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

The **Update Sprott ETF data** GitHub Actions workflow follows the sibling pattern: Sunday 00:00 UTC and manual runs; checkout v7 → setup-bun v2 → frozen install → updater tests → updater → commit/push only changed `api/sprott` files. No changes means no commit. A failed updater keeps previously published data in place.

GitHub permits 25 `workflow_dispatch` inputs, so the workflow exposes the 24 named controls as optional string inputs with empty defaults and uses the 25th, `advanced`, for a JSON object that reaches every control without a named input:

```yaml
advanced: '{"SEC_UA":"ops contact","VERBOSE":"true","SKIP_YAHOO":"true"}'
```

The resolution order is `scripts/update-data.config.json` → `advanced` JSON → nonblank individual inputs → protected Actions variable (`vars.SEC_UA`) or process ENV (`SPROTT_<NAME>` alias accepted for every control). A blank input inherits the checked-in JSON, and any **nonblank** value wins, including `0` and `false`. Locally, an explicitly set environment variable overrides the file even when empty.

[scripts/update-data.config.json](scripts/update-data.config.json) is the checked-in runtime default, loaded relative to the updater, not the current working directory. Edit this flat JSON to change defaults locally and in Actions. Only a missing JSON file permits built-in fallbacks; malformed or unreadable configuration fails instead of being silently ignored. `--help` prints the JSON defaults. All supplied filters use **AND** logic.

CI and the main-only Pages workflow retain their checks/deployment guards and use the same checkout/setup-bun conventions. Dependabot remains monthly for Bun and GitHub Actions. Checkout never persists credentials; the push step uses the runner token only in process memory via a temporary nonsecret askpass program, never a token in a file or Git configuration.

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

Sprott publishes no 30-day SEC yield, so `secYield` renders `—` and `secYieldKind` records `not published`; the catalog column stays honest for every fund. The history series is **market price, not official NAV**: `historySource` states Yahoo daily market-price closes/adjusted closes, and the derived figures are **not published standardized NAV returns**. Returns that a fund page publishes officially are used as published; only missing metrics are derived. The holdings CSV is the primary source and the page's holdings table is the fallback, so a fund page that drops the download still updates.

Live acceptance runs on a GitHub runner (this editing environment cannot reach the providers). The temporary acceptance workflow is deleted before the pull request; its evidence is committed at [scripts/fixtures/2026-10-01/live-acceptance.txt](scripts/fixtures/2026-10-01/live-acceptance.txt): a scoped isolated run twice byte-identical, a full generation pass that reproduces the committed `api/sprott` seed, and per-fund counts and hashes. During the first diagnostic pass Yahoo restated one SGDJ adjusted close across a rounding boundary (27.69 ↔ 27.7); the settled reruns and the published seed are byte-stable, and the finding is retained rather than hidden.

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` — official or coverage-checked derived YTD and 1-year returns → *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` — published or coverage-checked derived annualized 3Y/5Y/10Y figures → *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` — cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` → *TR 3Y/5Y/10Y*
- `siAnn` — since-inception annualized when date/age/coverage support it (not young cumulative SI) → *SI Ann.*
- `dividendYield` — indicated rate: latest positive distribution × payments per year ÷ market price
- `secYield` — `—`: Sprott publishes none

### Update controls

Defaults below are from `scripts/update-data.config.json`; blank Actions inputs do not override them.

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch evaluation size: positive resumes the scoped cursor in `api/sprott/update-state.json`; `0` is a full selected pass and resets the cursor. |
| `REQUEST_SLEEP` | `1` | Minimum seconds between outgoing request starts **in each independent lane**, including retries. |
| `CONCURRENCY` | `2` | Parallel fund workers / independent paced lanes. |
| `TICKERS` | all | Space/comma/semicolon allowlist, e.g. `URNM URNJ SETM`. Unknown requested tickers fail before writes. |
| `AUM` | `:` | Total net assets range: USD amounts or K/M/B/T suffixes; nano/micro/small/mid/large presets; inclusive min:max. |
| `TER` | `:` | Net total expense ratio range in % (strict min:max). |
| `DIVIDEND_YIELD` | `:` | Indicated distribution-yield range in %, min:max; missing values do not pass an active range. |
| `SEC_YIELD` | `:` | 30-day SEC-yield range in %, min:max; Sprott publishes none, so an active range filters everything out. |
| `HOLDINGS_PAGE_SIZE` | `250` | Holdings rows per JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Daily history rows per JSON page |
| `MAX_RETRIES` | `2` | Retries after the initial request, integer >= 1 (transient HTTP/network failures only) |
| `HISTORY_RANGE` | `max` | Yahoo daily history range: `max` or `Ny` (e.g. `5y`); merges with previously published history |
| `STORE_RAW_DOWNLOADS` | `false` | Keep raw provider payload snapshots beside the feed (config/`advanced` only) |
| `SEC_UA` | declared UA | SEC contact User-Agent; the Actions variable `SEC_UA` overrides it when nonblank. Do not put credentials here. |
| `SKIP_YAHOO` | `false` | Skip Yahoo history and dividends; retain published data |
| `SKIP_SPROTT` | `false` | Skip sprottetfs.com pages; retain published data (config/`advanced` only) |
| `EDGAR_FALLBACK` | `true` | SEC N-PORT-P holdings fallback for funds without a usable holdings sheet |
| `VERBOSE` | `false` | Provider/fallback/retry detail; the normal compact fund reporter always retains real zero/false and omits missing fields (config/`advanced` only) |
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

## TypeScript

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone — no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish: `bun install --frozen-lockfile`, `bun test`, `bun build --target=bun scripts/update-data.ts`, `bun build app.tsx` and `git diff --check`.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global X](https://github.com/daggerok/Global-X/) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott | sprottetfs.com fund navigation + official fund pages (holdings CSV, distributions, key facts) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance daily market-price history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT — same as all sibling ETF repositories.](./LICENSE)

Sprott® and the fund names/tickers referenced here are trademarks of Sprott Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Sprott Inc. All data is reproduced from Sprott's own public fund pages and downloads, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
