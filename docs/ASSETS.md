# Assets: precious metals and crypto currencies

This fork lets an account use a precious metal (gold `XAU`, silver `XAG`) or a crypto asset (BTC, ETH, SOL, USDT, USDC, XRP, ADA, DOGE, DOT, LTC, BNB, AVAX, LINK, XMR, TRX) as its "currency".
This document describes the design of the foundation (PR #1) and the hooks that later PRs (price history, auto fetch, charts) plug into.

The registry of assets lives in two places which must be kept in sync:

* backend: `pkg/core/asset.go` (`AllAssets`)
* frontend: `src/consts/currency.ts` (`ALL_ASSETS`)

To add a coin, add one line to both lists (plus the `currency.name.<CODE>` translation in `src/locales/*.json`).

## Units and storage

All amounts are stored as `int64`. Normal currencies are stored as `amount * 10^2`, this is unchanged.
Assets use a per-asset *scale*: `stored = amount * 10^scale`.

| Asset | Whole unit | Scale | Smallest unit | Max amount (limit 999,999,999,999,999 stored) |
|---|---|---|---|---|
| XAU, XAG | 1 gram | 2 | 0.01 g | 9,999,999,999,999.99 g |
| BTC, ETH, SOL, DOT, LTC, BNB, AVAX, LINK, XMR | 1 coin | 8 | 0.00000001 | 9,999,999.99999999 |
| USDT, USDC, XRP, ADA, DOGE, TRX | 1 coin | 6 | 0.000001 | 999,999,999.999999 |

* The transaction amount limit (`±999999999999999`) is not changed, so sums stay far away from the `int64` range.
* BTC amounts such as `0.00123456` round-trip exactly (the stored value is `123456`). Parsing never rounds: the frontend ignores digits beyond the scale and the backend helper `core.ParseAssetAmount` rejects them.
* The database is not changed for amounts. Only the length of the currency columns grew from `VARCHAR(3)` to `VARCHAR(10)` (`accounts.currency`, `user_custom_exchange_rates.currency`) because codes like `USDT` have four letters; xorm `Sync2` widens the columns on MySQL/PostgreSQL, SQLite does not enforce the length.
* The user's default currency can still only be an ISO 4217 currency (`validCurrency`), assets are accepted only for accounts and prices (`validAssetOrCurrency`).

### Gold and silver in grams or troy ounces

Metals are always stored in grams (0.01 g steps). The display/entry unit is a **device-local app setting** `metalDisplayUnit` (`g` default, or `oz`; Settings → Preferences → "Unit of Precious Metals").

* 1 troy ounce = 31.1034768 g (`GRAMS_PER_TROY_OUNCE`).
* In `oz` view amounts are shown with up to 4 decimals in lists and 6 decimals in inputs (so a stored value always survives a display → edit → save cycle unchanged); typed ounces are converted to grams and rounded to 0.01 g.
* Amounts are displayed with a unit label: `31.10 g`, `1.00 oz`, `0.00123456 BTC`.
* The `oz` preference does not affect crypto assets.
* Implementation: `src/lib/asset.ts` (`getAmountViewSpec`, `storedAmountToViewAmount`, `viewAmountToStoredAmount`) and the `scale`-aware `formatAmount` / `parseAmount` in `src/lib/numeral.ts`. `src/locales/helpers.ts` wires them into every formatter (`getNumberFormatOptions`, `getViewAmount`), so the lists, overview and statistics use them automatically.

### Currency selection

In account forms (desktop `CurrencySelect` with `with-assets`, mobile account edit page) the assets are appended after the normal currencies and labelled with their group: "Gold (Metals)", "Bitcoin (Crypto)" (Polish: "Metale szlachetne" / "Kryptowaluty"). The label is part of the display name, so typing "krypto" in the filter finds all of them.

## Price history and valuation in the default currency (PLN)

Totals on the overview/accounts pages are computed in the frontend with `exchangeRatesStore.getExchangedAmount(amount, from, to)`, which uses the `latestExchangeRates` list (`rate` = units of the currency per one unit of the base currency). To value assets the server adds one rate per asset to **every** exchange rate data source:

1. Prices are stored as a dated history in the table `asset_price` (PR #2, `models.AssetPrice`): primary key `(uid, asset, date)`, `price` (int64 = price × 10^10, so 400000 PLN and 0.0001 PLN are both exact; `models.ParseAssetPrice` / `FormatAssetPrice`), `source` (`auto`|`manual`), `source_name` (`nbp`|`coingecko`|`manual`), created/updated time. The table is created by xorm `SyncStructs` in `cmd/database.go` like the other tables (no manual migration). The price is "default currency per 1 g" (metals) or "per 1 coin" (crypto).
2. `date` is a plain calendar date `YYYY-MM-DD` without timezone: NBP prices use the date published by NBP (Poland), CoinGecko prices use the **UTC date** of the fetch, manual prices use the date typed by the user (the UI proposes the local date; the server accepts at most "tomorrow UTC").
3. **One price per (user, asset, date). A manual price always wins over an automatic one**: saving a manual price replaces an automatic row of the same date; the automatic update never overwrites a manual row (`models.PlanAutoAssetPriceWrites`); an automatic price of the same date is refreshed by the next automatic update (the latest price of the day wins). If you delete a manual price inside the fetched window, the next automatic update fills the day again.
4. `ExchangeRatesDataProviderContainer.GetLatestExchangeRates` post-processes the response of the configured provider: `appendAssetExchangeRates` reads the **latest price (greatest date) of every asset** (`AssetPricesService.GetLatestPrices`) and `mergeAssetPricesToExchangeRates` adds `rate(asset) = rate(default currency) / price`, so the format is the same as any other rate and works with NBP, ECB, user custom etc. Normal currency rates are unaffected. The frontend is unchanged by this (`getExchangedAmountByRate` multiplies by `10^(scale(to) - scale(from))`).
5. If no price exists for an asset the rate is missing and the account is excluded from the totals, exactly like a currency without an exchange rate.

**Migration of the PR #1 manual prices:** PR #1 stored manual prices in `user_custom_exchange_rates` (`rate_column = price * 10^8`). On first use (`AssetPricesService.MigrateLegacyPrices`, called by every history read and by the auto update) these rows are copied into `asset_price` as `manual` prices dated by the day they were saved (UTC), never overwriting an existing history row, and the legacy rows are marked deleted (the usual soft delete). The old endpoint `exchange_rates/user_custom/update.json` still accepts asset codes, but nothing in the UI uses it any more (its rows are migrated again on next read).

### Automatic update when the app is opened

Same mechanism as the exchange rate auto update, nothing runs in the background (no cron):

* The frontend calls `exchangeRatesStore.autoUpdateExchangeRatesData()` after login/unlock/app start. It now also calls `POST /api/v1/asset_prices/auto_update.json` if the user setting **"Auto-update Asset Prices"** (`autoUpdateAssetPricesData`, desktop + mobile Preferences, default ON, synced like the other cloud settings) is on, at most once per hour per device (`ebk_app_asset_prices_auto_update_time` in localStorage; `shouldAutoUpdateAssetPrices` in `src/lib/asset_price.ts`). When something was saved the exchange rates are reloaded. "Fetch Prices Now" in the asset prices UI skips the client-side hour limit.
* **Server:** `pkg/assetprices/updater.go`. Fetched data is cached in memory for one hour per API (and per vs-currency for crypto), so one server sends at most one request per API per hour, whatever the number of users or app openings. A failed request is not repeated for 10 minutes; failures are only logged and the old prices stay. Global off switch: `[asset_prices] enable_auto_update = false` in `conf/ezbookkeeping.ini` (env `EBK_ASSET_PRICES_ENABLE_AUTO_UPDATE=false`); then the endpoint answers `enabled=false` without any request. Timeout, proxy and TLS settings are taken from the `[exchange_rates]` section, the User-Agent is the project's outgoing User-Agent.
* **Only assets the user holds** (has a non-deleted account in) are stored, and when the user holds nothing no request is made at all.
* **Gold (XAU):** NBP `GET https://api.nbp.pl/api/cenyzlota/{start}/{end}?format=json` (PLN per gram, 1000 fineness). A fetch backfills 365 days when the user has no automatically fetched XAU price yet (manual prices do not count) or the newest one is older than 14 days in chunks of at most 93 days (NBP limit; 4 requests), later fetches take the last 14 days. A 404 of NBP (no prices in the range) is not an error. NBP publishes in PLN only: **if the user's default currency is not PLN the automatic gold update is skipped** (logged), enter gold prices manually in that case.
* **Crypto:** CoinGecko `GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=<default currency lower case>&order=market_cap_desc&per_page=250&page=1&sparkline=false`: a **fixed broad list (top 250 by market cap)**, the request is identical for every user so it never reveals holdings. Prices of held coins of the registry (`CoinGeckoId`) are stored for the UTC date of the fetch. If CoinGecko does not support the currency the request fails and nothing is stored. **No per-coin history requests are made** (`/coins/{id}/market_chart` would reveal which coin is held); the crypto history therefore grows from the day the account exists (a manual history backfill button was not implemented).
* **Silver (XAG): manual only.** NBP does not publish silver and no free no-key source was considered reliable enough.
* **Privacy:** only plain `GET` requests of public prices, nothing from the database (holdings, amounts, user ids) is ever sent. The browser itself never contacts the price APIs.

### API

| Endpoint | Description |
|---|---|
| `GET /api/v1/asset_prices/latest.json` | latest price of every asset which has one: `[{asset, date, price, source, sourceName, updateTime}]` |
| `GET /api/v1/asset_prices/series.json?asset=XAU&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | **price series for charts (PR #3)**: `[{date, price, source, sourceName}]` ascending by date, dates inclusive, both dates optional; `price` is an exact decimal string |
| `POST /api/v1/asset_prices/save.json` `{asset, date, price}` | manual price (insert or replace) |
| `POST /api/v1/asset_prices/delete.json` `{asset, date}` | delete the price of a date |
| `POST /api/v1/asset_prices/auto_update.json` | triggers the update described above, returns `{enabled, updatedAssets, savedCount}` |

Frontend: store `src/stores/assetPrices.ts` (`loadAssetPriceSeries` is what chart code should call), UI desktop `AssetPricesDialog.vue` (latest prices, "History" → add/edit/delete a price of a date), mobile `AssetPricesPage.vue` + `AssetPriceHistoryPage.vue` (route `/exchange_rates/assets/history?asset=XAU`). Metal prices are shown per gram and per troy ounce.

### Hooks for PR #3 (charts) – #4

* Price line: `GET /asset_prices/series.json`.
* The asset registry already contains `CoinGeckoId` (Go) / `coinGeckoId` (TS).
* Chart markers: transactions with `timeUnknown=true` must be excluded (see below).

## Optional acquisition date ("Date unknown")

`transactions.time_unknown` (nullable boolean, added by xorm `Sync2`; old rows read as `false`) → API field `timeUnknown` on create/modify/info. The transaction time itself is still stored (it is the creation time and defines the order), balances include these transactions as usual. The edit form (desktop dialog, mobile page) has a "Date unknown" switch, and the lists show "Date unknown" ("Data nieznana") instead of the time.
A transfer's counterpart row copies the flag. Imports (`TransactionCreateRequest`) default to `false`.

## Known limitations of this PR

* File importers/exporters and the MCP tools still read/write amounts with two decimals; they are meant for normal currencies.
* The exchange rate page converter and statistics that use the fixed `AMOUNT_FACTOR` (e.g. the explorer variance statistics) operate on amounts already converted to the default currency, so they are not affected.
* The metal unit preference is per device (local setting), not per account and not synchronized.
