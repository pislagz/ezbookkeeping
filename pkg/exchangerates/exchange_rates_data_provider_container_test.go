package exchangerates

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

func newTestResponse(baseCurrency string, rates map[string]string) *models.LatestExchangeRateResponse {
	list := make(models.LatestExchangeRateSlice, 0, len(rates))

	for currency, rate := range rates {
		list = append(list, &models.LatestExchangeRate{Currency: currency, Rate: rate})
	}

	return &models.LatestExchangeRateResponse{
		DataSource:    "test",
		BaseCurrency:  baseCurrency,
		ExchangeRates: list,
	}
}

func findRate(response *models.LatestExchangeRateResponse, currency string) (string, bool) {
	for _, rate := range response.ExchangeRates {
		if rate.Currency == currency {
			return rate.Rate, true
		}
	}

	return "", false
}

func TestMergeAssetPricesToExchangeRates_DefaultCurrencyIsBase(t *testing.T) {
	response := newTestResponse("PLN", map[string]string{"PLN": "1", "USD": "0.25"})

	merged := mergeAssetPricesToExchangeRates(response, "PLN", map[string]float64{"XAU": 500, "BTC": 400000})

	rate, ok := findRate(merged, "XAU")
	assert.True(t, ok)
	assert.Equal(t, "0.002", rate) // 1 PLN = 0.002 g of gold

	rate, ok = findRate(merged, "BTC")
	assert.True(t, ok)
	assert.Equal(t, "0.0000025", rate)

	_, ok = findRate(merged, "USD")
	assert.True(t, ok)

	// the original response must not be modified
	_, ok = findRate(response, "XAU")
	assert.False(t, ok)
}

func TestMergeAssetPricesToExchangeRates_DefaultCurrencyIsNotBase(t *testing.T) {
	// base is EUR, 1 EUR = 4 PLN, so 1 PLN = 0.25 EUR
	response := newTestResponse("EUR", map[string]string{"EUR": "1", "PLN": "4"})

	merged := mergeAssetPricesToExchangeRates(response, "PLN", map[string]float64{"XAG": 8})

	rate, ok := findRate(merged, "XAG")
	assert.True(t, ok)
	assert.Equal(t, "0.5", rate) // 8 PLN per gram = 2 EUR per gram, so 1 EUR = 0.5 g
}

func TestMergeAssetPricesToExchangeRates_NoRateOfDefaultCurrency(t *testing.T) {
	response := newTestResponse("EUR", map[string]string{"EUR": "1", "USD": "1.1"})

	merged := mergeAssetPricesToExchangeRates(response, "PLN", map[string]float64{"XAU": 500})
	_, ok := findRate(merged, "XAU")
	assert.False(t, ok) // cannot be converted, nothing is added
}

func TestMergeAssetPricesToExchangeRates_ReplacesAssetRatesFromDataSource(t *testing.T) {
	response := newTestResponse("PLN", map[string]string{"PLN": "1", "XAU": "123"})

	merged := mergeAssetPricesToExchangeRates(response, "PLN", map[string]float64{"XAU": 500})
	rate, ok := findRate(merged, "XAU")
	assert.True(t, ok)
	assert.Equal(t, "0.002", rate)
	assert.Equal(t, 2, len(merged.ExchangeRates))
}

type failingExchangeRatesProvider struct{ t *testing.T }

func (p *failingExchangeRatesProvider) GetLatestExchangeRates(c core.Context, uid int64, currentConfig *settings.Config) (*models.LatestExchangeRateResponse, error) {
	p.t.Fatal("the online exchange rates provider must not be used in offline mode")
	return nil, nil
}

func TestSelectProvider_OfflineModeNeverUsesOnlineProvider(t *testing.T) {
	online := &failingExchangeRatesProvider{t: t}
	container := &ExchangeRatesDataProviderContainer{current: online}
	c := core.NewNullContext()

	// default behaviour is unchanged
	assert.Same(t, online, container.selectProvider(c, 1, &settings.Config{OfflineMode: false}))
	assert.Same(t, online, container.selectProvider(c, 1, nil))

	// offline: a local provider is used, it is not the online one
	selected := container.selectProvider(c, 1, &settings.Config{OfflineMode: true})
	assert.NotSame(t, online, selected)
	_, isLocal := selected.(*UserCustomExchangeRatesDataProvider)
	assert.True(t, isLocal)

	// offline with the user custom data source keeps the same provider
	local := newUserCustomExchangeRatesDataProvider()
	container = &ExchangeRatesDataProviderContainer{current: local}
	assert.Same(t, local, container.selectProvider(c, 1, &settings.Config{OfflineMode: true}))
}
