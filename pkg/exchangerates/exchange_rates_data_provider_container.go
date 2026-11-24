package exchangerates

import (
	"crypto/tls"
	"sort"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/services"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
	"github.com/mayswind/ezbookkeeping/pkg/utils"
)

// ExchangeRatesDataProviderContainer contains the current exchange rates data provider
type ExchangeRatesDataProviderContainer struct {
	current ExchangeRatesDataProvider
}

// Initialize a exchange rates data provider container singleton instance
var (
	Container = &ExchangeRatesDataProviderContainer{}
)

// InitializeExchangeRatesDataSource initializes the current exchange rates data source according to the config
func InitializeExchangeRatesDataSource(config *settings.Config) error {
	if config.ExchangeRatesDataSource == settings.CentralBankOfArgentinaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CentralBankOfArgentinaDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfBelarusDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfBelarusDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.BankOfCanadaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &BankOfCanadaDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.CzechNationalBankDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CzechNationalBankDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.DanmarksNationalbankDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &DanmarksNationalbankDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.EuroCentralBankDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &EuroCentralBankDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfGeorgiaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfGeorgiaDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.CentralBankOfHungaryDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CentralBankOfHungaryDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.BankOfIsraelDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &BankOfIsraelDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.BankOfItalyDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &BankOfItalyDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfKazakhstanDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfKazakhstanDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.CentralBankOfMalaysiaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CentralBankOfMalaysiaDataSource{}, tls.TLS_RSA_WITH_AES_128_GCM_SHA256)
		return nil
	} else if config.ExchangeRatesDataSource == settings.CentralBankOfMyanmarDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CentralBankOfMyanmarDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NorgesBankDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NorgesBankDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfPolandDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfPolandDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfRomaniaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfRomaniaDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.BankOfRussiaDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &BankOfRussiaDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.SwissNationalBankDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &SwissNationalBankDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.NationalBankOfUkraineDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &NationalBankOfUkraineDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.CentralBankOfUzbekistanDataSource {
		Container.current = newCommonHttpExchangeRatesDataProvider(config, &CentralBankOfUzbekistanDataSource{})
		return nil
	} else if config.ExchangeRatesDataSource == settings.UserCustomExchangeRatesDataSource {
		Container.current = newUserCustomExchangeRatesDataProvider()
		return nil
	}

	return errs.ErrInvalidExchangeRatesDataSource
}

// GetLatestExchangeRates returns the latest exchange rates data from the current exchange rates data source
func (e *ExchangeRatesDataProviderContainer) GetLatestExchangeRates(c core.Context, uid int64, currentConfig *settings.Config) (*models.LatestExchangeRateResponse, error) {
	if Container.current == nil {
		return nil, errs.ErrInvalidExchangeRatesDataSource
	}

	response, err := e.current.GetLatestExchangeRates(c, uid, currentConfig)

	if err != nil || response == nil || uid <= 0 {
		return response, err
	}

	return e.appendAssetExchangeRates(c, uid, response), nil
}

// appendAssetExchangeRates adds the rates of assets (precious metals and crypto currencies) to the exchange rates response of any data source.
//
// Assets have no rates in the data sources, so the user enters a price (in the user's default currency per one gram or one coin) which
// is stored in the user custom exchange rate table. The price is converted to the same format as the rates of the data source
// (units of the asset per one unit of the response base currency), so the client does not need to know where a rate comes from.
//
// HOOK for dated asset price history (price history table + auto-fetch): replace the call of GetAllCustomExchangeRatesByUid in
// this function by "latest price of every asset on or before today", the rest of the function stays unchanged.
func (e *ExchangeRatesDataProviderContainer) appendAssetExchangeRates(c core.Context, uid int64, response *models.LatestExchangeRateResponse) *models.LatestExchangeRateResponse {
	user, err := services.Users.GetUserById(c, uid)

	if err != nil {
		log.Warnf(c, "[exchange_rates_data_provider_container.appendAssetExchangeRates] failed to get user \"uid:%d\", because %s", uid, err.Error())
		return response
	}

	customRates, err := services.UserCustomExchangeRates.GetAllCustomExchangeRatesByUid(c, uid)

	if err != nil {
		log.Warnf(c, "[exchange_rates_data_provider_container.appendAssetExchangeRates] failed to get asset prices for user \"uid:%d\", because %s", uid, err.Error())
		return response
	}

	prices := make(map[string]float64)

	for _, customRate := range customRates {
		if core.IsAsset(customRate.Currency) {
			prices[customRate.Currency] = customRate.ToAssetPrice()
		}
	}

	if len(prices) < 1 {
		return response
	}

	defaultCurrencyRate := float64(0)

	if user.DefaultCurrency == response.BaseCurrency {
		defaultCurrencyRate = 1
	}

	for _, exchangeRate := range response.ExchangeRates {
		if exchangeRate.Currency == user.DefaultCurrency {
			if rate, err := utils.StringToFloat64(exchangeRate.Rate); err == nil {
				defaultCurrencyRate = rate
			}

			break
		}
	}

	if defaultCurrencyRate <= 0 {
		return response
	}

	newRates := make(models.LatestExchangeRateSlice, 0, len(response.ExchangeRates)+len(prices))

	for _, exchangeRate := range response.ExchangeRates {
		if !core.IsAsset(exchangeRate.Currency) {
			newRates = append(newRates, exchangeRate)
		}
	}

	for _, asset := range core.AllAssets {
		if price, exists := prices[asset.Code]; exists && price > 0 {
			newRates = append(newRates, &models.LatestExchangeRate{
				Currency: asset.Code,
				Rate:     utils.Float64ToString(defaultCurrencyRate / price),
			})
		}
	}

	sort.Sort(newRates)

	// copy the response to avoid modifying cached data of the data source
	newResponse := *response
	newResponse.ExchangeRates = newRates

	return &newResponse
}
