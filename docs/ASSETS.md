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

## Valuation in the default currency (PLN)

Totals on the overview/accounts pages are computed in the frontend with `exchangeRatesStore.getExchangedAmount(amount, from, to)`, which uses the `latestExchangeRates` list (`rate` = units of the currency per one unit of the base currency). To value assets we make the server add one rate per asset to **every** exchange rate data source:

1. The user enters a price: *default currency per 1 g* (metals) or *per 1 coin* (crypto), in "Exchange Rates Data → Asset Prices" (desktop dialog `AssetPricesDialog.vue`, mobile page `AssetPricesPage.vue`).
2. The price is stored in the existing user custom exchange rate table (`user_custom_exchange_rates`), endpoint `POST /api/v1/exchange_rates/user_custom/update.json` with `currency=XAU` and `rate=<price>`.
   **Asset rows have a different meaning than currency rows:** `rate_column = price * 10^8` (a price, not "units per default currency"). The usual representation would lose precision for expensive coins (1/400000 PLN stored with 8 digits would only keep 3 significant digits).
3. `ExchangeRatesDataProviderContainer.GetLatestExchangeRates` post-processes the response of the configured provider: `appendAssetExchangeRates` → `mergeAssetPricesToExchangeRates` adds `rate(asset) = rate(default currency) / price` so the format is the same as any other rate and works with NBP, ECB, user custom etc. No data is sent anywhere.
4. `getExchangedAmountByRate` multiplies by `10^(scale(to) - scale(from))` so BTC (scale 8) → PLN (scale 2) is correct.
5. The asset rows are hidden from the generic exchange rate table; they are edited only in the asset prices UI.

If no price is entered for an asset the rate is missing and the account is excluded from the totals, exactly like a currency without an exchange rate.

### Hook for PR #2 (price history) – #4 (charts)

* Replace the source of the prices in `appendAssetExchangeRates` (`pkg/exchangerates/exchange_rates_data_provider_container.go`): instead of `GetAllCustomExchangeRatesByUid`, read "latest price of every asset on or before today" from the new `asset_prices(asset, date, price, source)` table. `mergeAssetPricesToExchangeRates` and the whole frontend stay unchanged.
* The manual price from this PR can be migrated to the new table as `source=manual` (the asset prices UI should then write there; `AssetPricesPageBase.ts` is the only place that talks to the store).
* The asset registry already contains `CoinGeckoId` (Go) / `coinGeckoId` (TS) for the crypto fetcher; request a fixed broad list (`/coins/markets?vs_currency=pln&per_page=250`) so the request does not reveal holdings.
* Chart markers: transactions with `timeUnknown=true` must be excluded (see below).

## Optional acquisition date ("Date unknown")

`transactions.time_unknown` (nullable boolean, added by xorm `Sync2`; old rows read as `false`) → API field `timeUnknown` on create/modify/info. The transaction time itself is still stored (it is the creation time and defines the order), balances include these transactions as usual. The edit form (desktop dialog, mobile page) has a "Date unknown" switch, and the lists show "Date unknown" ("Data nieznana") instead of the time.
A transfer's counterpart row copies the flag. Imports (`TransactionCreateRequest`) default to `false`.

## Known limitations of this PR

* File importers/exporters and the MCP tools still read/write amounts with two decimals; they are meant for normal currencies.
* The exchange rate page converter and statistics that use the fixed `AMOUNT_FACTOR` (e.g. the explorer variance statistics) operate on amounts already converted to the default currency, so they are not affected.
* The metal unit preference is per device (local setting), not per account and not synchronized.
