# Offline mode and the inventory of outbound requests

ezBookkeeping is self-hosted and works without internet access. Some optional features contact public services. This document lists **every** outbound request in the code base and describes the one switch which turns the default ones off.

## The switch

```ini
[network]
offline_mode = false   # default: behaviour unchanged
```

* Environment variable (same mechanism as every other setting, `EBK_<SECTION>_<KEY>`): **`EBK_NETWORK_OFFLINE_MODE=true`**. The environment wins over the ini file. `EBK_NETWORK_OFFLINE_MODE_FILE=/path` (read the value from a file) works as for the other settings.
* Changing it needs a restart of the server.

With `offline_mode = true`:

| Area | Behaviour |
|---|---|
| Exchange rates | The online data source is never contacted. `GET /api/v1/exchange_rates/latest.json` answers from the local database only (the rates the user entered, `user_custom` source) plus the prices of metals/crypto. |
| Asset prices (gold, crypto) | `POST /api/v1/asset_prices/auto_update.json` returns `{"enabled":false,"offline":true,"updatedAssets":[],"savedCount":0}` without any request and without touching the database. Manual prices, the stored history, `series.json` and the charts keep working. |
| Map | Disabled (`map_provider` is treated as empty): no tiles, no Google/Baidu/Amap scripts, the map image proxy answers an error. |
| Avatars | The `gravatar` avatar provider is disabled (the browser would load images from gravatar.com). `internal` (stored in your own storage) is unaffected. |
| Frontend | `server_settings.js` exposes `off=1`. The app does not call the update endpoints, the "auto-update" switches in Preferences are disabled, the "Fetch Prices Now" button is replaced by an "Offline mode is on" hint, no error toast is shown. The frontend itself never loads fonts, scripts or images from a CDN (everything is bundled in `public/`). |
| Things you configure yourself | **Not touched** (see the table below, "only if you configure it"). Simply leave them unconfigured for a fully offline instance. |

## Inventory

"Default" is the default of `conf/ezbookkeeping.ini`. "Offline mode" is what `offline_mode = true` does.

| # | What | Where in code | Default | Offline mode |
|---|---|---|---|---|
| 1 | Exchange rates from a central bank (one of 20 sources, default `euro_central_bank`; ECB, NBP, SNB, Bank of Canada, …) | `pkg/exchangerates/*_datasource.go`, `common_http_exchange_rates_data_provider.go`; called from `pkg/api/exchange_rates.go` | **on** (when a user opens the exchange rates page or has auto-update on; cached by the client per day) | **off** – local rates only (`ExchangeRatesDataProviderContainer.selectProvider`) |
| 2 | Gold price + history from NBP `api.nbp.pl/api/cenyzlota` | `pkg/assetprices/updater.go` | **on** (`[asset_prices] enable_auto_update`, user setting; at most 1×/hour/server; only if the user holds XAU) | **off** – `Updater.Update` returns before any request |
| 3 | Crypto prices from CoinGecko `api.coingecko.com/api/v3/coins/markets` (fixed top-250 list, identical for all users) | `pkg/assetprices/updater.go` | **on** (same switches; only if the user holds a coin) | **off** (same) |
| 4 | Map tiles (OpenStreetMap, OpenTopoMap, CartoDB, TomTom, Tianditu, custom) loaded by the **browser** or via the server's map proxy `GET /proxy/map/...` | `src/consts/map.ts`, `src/lib/map/leaflet.ts`; server: `pkg/api/map_image_proxies.go` | **off** (`[map] map_provider` is empty) – on only if you set a provider | **disabled** even if configured; proxy handlers refuse requests |
| 5 | Map scripts from Google Maps, Baidu, Amap loaded by the browser | `src/consts/api.ts`, `src/lib/map/googlemap.ts`, `baidumap.ts`, `amap.ts` | **off** (needs a provider + key) | **disabled** (same) |
| 6 | Gravatar avatar images loaded by the browser from `www.gravatar.com` (hash of the e-mail address) | `pkg/avatars/gravatar_provider.go` | **off** (`[user] avatar_provider = internal`) | **disabled** |
| 7 | OAuth2 / OIDC login (provider discovery, token and userinfo requests by the server; the browser is redirected to the provider) | `pkg/auth/oauth2/…` | **off** (`[auth] enable_oauth2_auth = false`) | only if you configure it – not changed |
| 8 | SMTP e-mail (password reset, verification) | `pkg/mail/` | **off** (`[mail] enable_smtp = false`) | only if you configure it – not changed |
| 9 | Object storage: S3, MinIO, WebDAV (avatars, pictures) | `pkg/storage/s3_storage.go`, `minio_storage.go`, `webdav_storage.go` | **off** (`[storage] type = local_filesystem`) | only if you configure it – not changed |
| 10 | LLM / AI receipt and text recognition, coding assistant (OpenAI, Anthropic, Google AI, OpenRouter, Ollama, LM Studio, compatible APIs) | `pkg/llm/provider/…` | **off** (no provider configured) | only if you configure it – not changed |
| 11 | MCP server, API tokens | server side only, inbound requests | off | – (no outbound request) |
| 12 | Version / update check, telemetry, analytics | none exist in the code | – | – |
| 13 | Fonts, CDN scripts, icons, external images in the web app | none (bundled by Vite into `public/`); the "About" dialog only contains plain links that open when you click them | – | – |
| 14 | Proxy settings `[exchange_rates] proxy`, `[map] proxy`, `skip_tls_verify` | `pkg/httpclient`, `pkg/api/map_image_proxies.go` | `system` | irrelevant for items 1–6 (no connection is made) |

Everything sent is a plain `GET` of a public URL (items 1–5): no user data, account, amount or holding is sent. See `docs/ASSETS.md` for the privacy design of items 2 and 3.

## How to verify that nothing is fetched

1. Start with offline mode and a log that is easy to watch:

   ```bash
   EBK_NETWORK_OFFLINE_MODE=true EBK_LOG_LEVEL=debug ./ezbookkeeping server run
   # docker: -e EBK_NETWORK_OFFLINE_MODE=true -e EBK_LOG_LEVEL=debug ; docker logs -f ezbookkeeping
   ```

2. Open `http://<host>:8080/server_settings.js`: it contains `_["off"]=1;`.
3. Use the app: open the exchange rates page, asset prices, "Fetch Prices Now" (hidden in offline mode) or call `POST /api/v1/asset_prices/auto_update.json` with a token. The response has `"offline":true`, and the log contains no `failed to request latest exchange rate data`, no `[asset_prices.updateGold]` / `[asset_prices.getCryptoPrices]` lines and no other message about a failed request. With debug log the exchange rate component logs `offline mode is enabled, use the local exchange rates ...`.
4. Optional, network level: block outbound traffic of the container/host with the firewall (or `docker network create --internal`, then attach the container and your reverse proxy to it) and check that the log has no connection errors (`failed to request`, `dial tcp`, `no such host`).
5. Automated tests: `go test ./pkg/settings ./pkg/assetprices ./pkg/exchangerates` (config parsing from ini and environment; the asset price updater and the exchange rate provider selection never touch the network in offline mode – a transport which fails the test on any request is injected) and `npx vitest run src/lib/__tests__/asset_price.test.ts`.
