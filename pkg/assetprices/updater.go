package assetprices

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/httpclient"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/services"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

const (
	// cacheDuration is the minimum interval between two requests to the same public API on one server
	cacheDuration = time.Hour
	// failureBackoff is the minimum interval between two requests after a failed request
	failureBackoff = 10 * time.Minute

	goldRecentDays   = 14
	goldBackfillDays = 365
	goldAssetCode    = "XAU"
	goldCurrency     = "PLN" // NBP publishes gold prices in PLN only
)

type goldCache struct {
	fetchedAt time.Time
	from      string
	prices    []DatedPrice
}

type cryptoCache struct {
	fetchedAt time.Time
	prices    map[string]string // by CoinGecko id
}

// Updater fetches public asset prices (when the app is opened) and stores them in the asset price history of a user.
// The fetched data is cached in memory, so one server sends at most one request per API per hour whatever the number of users.
type Updater struct {
	mu         sync.Mutex
	httpClient *http.Client
	goldUrl    func(r DateRange) string
	marketsUrl func(vsCurrency string) string
	now        func() time.Time

	gold         *goldCache
	goldFailure  time.Time
	crypto       map[string]*cryptoCache
	cryptoFailed map[string]time.Time
}

// Initialize an asset prices updater singleton instance, it is configured by InitializeUpdater
var (
	DefaultUpdater = NewUpdater(nil)
)

// InitializeUpdater configures the singleton updater with the http settings of the exchange rates (timeout, proxy)
func InitializeUpdater(config *settings.Config) {
	DefaultUpdater = NewUpdater(httpclient.NewHttpClient(config.ExchangeRatesRequestTimeout, config.ExchangeRatesProxy, config.ExchangeRatesSkipTLSVerify, core.GetOutgoingUserAgent(), config.EnableDebugLog, nil))
}

// NewUpdater returns a new updater
func NewUpdater(httpClient *http.Client) *Updater {
	return &Updater{
		httpClient:   httpClient,
		goldUrl:      buildNbpGoldPriceUrl,
		marketsUrl:   buildCoinGeckoMarketsUrl,
		now:          time.Now,
		crypto:       make(map[string]*cryptoCache),
		cryptoFailed: make(map[string]time.Time),
	}
}

// Update fetches (or reads from the cache) the public prices of the assets which the user holds and saves them as automatic prices.
// Nothing is requested when the user holds no asset. Failures are logged, the old prices are kept.
func (u *Updater) Update(c core.Context, config *settings.Config, uid int64, defaultCurrency string) *models.AssetPriceAutoUpdateResponse {
	response := &models.AssetPriceAutoUpdateResponse{Enabled: config.EnableAssetPricesAutoUpdate, UpdatedAsset: []string{}}

	if !config.EnableAssetPricesAutoUpdate || u.httpClient == nil {
		response.Enabled = false
		return response
	}

	held, err := u.getHeldAssets(c, uid)

	if err != nil {
		log.Warnf(c, "[asset_prices.Update] failed to get accounts of user \"uid:%d\", because %s", uid, err.Error())
		return response
	}

	if err = services.AssetPrices.MigrateLegacyPrices(c, uid); err != nil {
		log.Warnf(c, "[asset_prices.Update] failed to migrate legacy asset prices of user \"uid:%d\", because %s", uid, err.Error())
	}

	if held[goldAssetCode] {
		u.updateGold(c, uid, defaultCurrency, response)
	}

	if held["XAG"] {
		log.Debugf(c, "[asset_prices.Update] there is no free public source for silver prices, silver prices are manual only")
	}

	u.updateCrypto(c, uid, defaultCurrency, held, response)

	return response
}

func (u *Updater) getHeldAssets(c core.Context, uid int64) (map[string]bool, error) {
	accounts, err := services.Accounts.GetAllAccountsByUid(c, uid)

	if err != nil {
		return nil, err
	}

	held := make(map[string]bool)

	for _, account := range accounts {
		if core.IsAsset(account.Currency) {
			held[account.Currency] = true
		}
	}

	return held, nil
}

func (u *Updater) updateGold(c core.Context, uid int64, defaultCurrency string, response *models.AssetPriceAutoUpdateResponse) {
	if defaultCurrency != goldCurrency {
		log.Infof(c, "[asset_prices.updateGold] gold prices from NBP are in %s only, skip the automatic update for default currency %s of user \"uid:%d\"", goldCurrency, defaultCurrency, uid)
		return
	}

	hasPrice, err := services.AssetPrices.HasAnyPrice(c, uid, goldAssetCode)

	if err != nil {
		log.Warnf(c, "[asset_prices.updateGold] failed to check gold prices of user \"uid:%d\", because %s", uid, err.Error())
		return
	}

	series, err := u.getGoldSeries(c, !hasPrice)

	if err != nil {
		log.Warnf(c, "[asset_prices.updateGold] failed to fetch gold prices, keep old prices, because %s", err.Error())
		return
	}

	u.save(c, uid, goldAssetCode, models.AssetPriceSourceNameNBP, series, response)
}

func (u *Updater) updateCrypto(c core.Context, uid int64, defaultCurrency string, held map[string]bool, response *models.AssetPriceAutoUpdateResponse) {
	assets := make([]*core.AssetInfo, 0)

	for _, asset := range core.AllAssets {
		if held[asset.Code] && asset.Kind == core.ASSET_KIND_CRYPTO && asset.CoinGeckoId != "" {
			assets = append(assets, asset)
		}
	}

	if len(assets) < 1 {
		return
	}

	prices, date, err := u.getCryptoPrices(c, defaultCurrency)

	if err != nil {
		log.Warnf(c, "[asset_prices.updateCrypto] failed to fetch crypto prices, keep old prices, because %s", err.Error())
		return
	}

	for _, asset := range assets {
		if price, exists := prices[asset.CoinGeckoId]; exists {
			u.save(c, uid, asset.Code, models.AssetPriceSourceNameCoinGecko, []DatedPrice{{Date: date, Price: price}}, response)
		}
	}
}

func (u *Updater) save(c core.Context, uid int64, asset string, sourceName string, series []DatedPrice, response *models.AssetPriceAutoUpdateResponse) {
	dbPrices := make([]*models.AssetPrice, 0, len(series))

	for _, item := range series {
		price, err := models.ParseAssetPrice(item.Price)

		if err != nil {
			continue
		}

		dbPrices = append(dbPrices, &models.AssetPrice{Date: item.Date, Price: price})
	}

	count, err := services.AssetPrices.SaveAutoPrices(c, uid, asset, sourceName, dbPrices)

	if err != nil {
		log.Warnf(c, "[asset_prices.save] failed to save prices of \"%s\" for user \"uid:%d\", because %s", asset, uid, err.Error())
		return
	}

	if count > 0 {
		response.SavedCount += count
		response.UpdatedAsset = append(response.UpdatedAsset, asset)
	}
}

// getGoldSeries returns the cached gold price series, it is requested from NBP at most once per hour (the first fetch of a user backfills one year)
func (u *Updater) getGoldSeries(c core.Context, backfill bool) ([]DatedPrice, error) {
	u.mu.Lock()
	defer u.mu.Unlock()

	now := u.now()
	days := goldRecentDays

	if backfill {
		days = goldBackfillDays
	}

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := today.AddDate(0, 0, -days)
	fromDate := from.Format(models.AssetPriceDateFormat)

	if u.gold != nil && now.Sub(u.gold.fetchedAt) < cacheDuration && u.gold.from <= fromDate {
		return u.gold.prices, nil
	}

	if !u.goldFailure.IsZero() && now.Sub(u.goldFailure) < failureBackoff {
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	all := make([]DatedPrice, 0)

	for _, r := range SplitDateRange(from, today, nbpMaxDaysPerRequest) {
		body, status, err := u.get(c, u.goldUrl(r))

		if status == http.StatusNotFound {
			continue // NBP answers 404 when there are no prices in the range (e.g. only holidays)
		}

		if err != nil {
			u.goldFailure = now
			return nil, err
		}

		prices, err := ParseNbpGoldPrices(body)

		if err != nil {
			u.goldFailure = now
			return nil, err
		}

		all = append(all, prices...)
	}

	u.gold = &goldCache{fetchedAt: now, from: fromDate, prices: all}
	u.goldFailure = time.Time{}

	return all, nil
}

// getCryptoPrices returns the cached prices of the fixed top-250 list by CoinGecko id, and the UTC date of the fetch
func (u *Updater) getCryptoPrices(c core.Context, defaultCurrency string) (map[string]string, string, error) {
	u.mu.Lock()
	defer u.mu.Unlock()

	vs := strings.ToLower(defaultCurrency)
	now := u.now()

	if cached, exists := u.crypto[vs]; exists && now.Sub(cached.fetchedAt) < cacheDuration {
		return cached.prices, cached.fetchedAt.UTC().Format(models.AssetPriceDateFormat), nil
	}

	if failedAt, exists := u.cryptoFailed[vs]; exists && now.Sub(failedAt) < failureBackoff {
		return nil, "", errs.ErrFailedToRequestRemoteApi
	}

	body, _, err := u.get(c, u.marketsUrl(vs))

	if err == nil {
		var prices map[string]string
		prices, err = ParseCoinGeckoMarkets(body)

		if err == nil {
			u.crypto[vs] = &cryptoCache{fetchedAt: now, prices: prices}
			delete(u.cryptoFailed, vs)

			return prices, now.UTC().Format(models.AssetPriceDateFormat), nil
		}
	}

	u.cryptoFailed[vs] = now

	return nil, "", err
}

// get sends a plain GET request without any user data
func (u *Updater) get(c core.Context, url string) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)

	if err != nil {
		return nil, 0, errs.ErrFailedToRequestRemoteApi
	}

	req = req.WithContext(httpclient.CustomHttpResponseLog(c, func(data []byte) {
		log.Debugf(c, "[asset_prices.get] response is %s", data)
	}))

	resp, err := u.httpClient.Do(req)

	if err != nil {
		log.Warnf(c, "[asset_prices.get] failed to request \"%s\", because %s", url, err.Error())
		return nil, 0, errs.ErrFailedToRequestRemoteApi
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)

	if err != nil || resp.StatusCode != http.StatusOK {
		log.Warnf(c, "[asset_prices.get] request \"%s\" failed, response code is %d", url, resp.StatusCode)
		return nil, resp.StatusCode, errs.ErrFailedToRequestRemoteApi
	}

	return body, resp.StatusCode, nil
}
