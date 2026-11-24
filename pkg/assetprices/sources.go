package assetprices

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/models"
)

// nbpGoldPriceUrlFormat is the NBP gold price API (PLN per gram of gold of 1000 fineness), arguments are start date and end date.
// API documentation: https://api.nbp.pl/en.html (a range request is limited to 93 days)
const nbpGoldPriceUrlFormat = "https://api.nbp.pl/api/cenyzlota/%s/%s?format=json"

// nbpMaxDaysPerRequest is the maximum number of days NBP allows in one range request
const nbpMaxDaysPerRequest = 93

// coinGeckoMarketsUrlFormat is a FIXED broad list (the top 250 coins by market cap), so the request never reveals which coins the user holds.
// API documentation: https://docs.coingecko.com/v3.0.1/reference/coins-markets
const coinGeckoMarketsUrlFormat = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=%s&order=market_cap_desc&per_page=250&page=1&sparkline=false"

// DatedPrice represents a price (decimal string, default currency per unit) of a date
type DatedPrice struct {
	Date  string
	Price string
}

// DateRange represents a closed range of dates (YYYY-MM-DD)
type DateRange struct {
	Start string
	End   string
}

// SplitDateRange splits the range into chunks of at most maxDays days (both ends inclusive), ordered by date ascending
func SplitDateRange(start time.Time, end time.Time, maxDays int) []DateRange {
	if maxDays < 1 || end.Before(start) {
		return nil
	}

	ranges := make([]DateRange, 0)
	chunkStart := start

	for !chunkStart.After(end) {
		chunkEnd := chunkStart.AddDate(0, 0, maxDays-1)

		if chunkEnd.After(end) {
			chunkEnd = end
		}

		ranges = append(ranges, DateRange{
			Start: chunkStart.Format(models.AssetPriceDateFormat),
			End:   chunkEnd.Format(models.AssetPriceDateFormat),
		})

		chunkStart = chunkEnd.AddDate(0, 0, 1)
	}

	return ranges
}

type nbpGoldPrice struct {
	Date  string      `json:"data"`
	Price json.Number `json:"cena"`
}

// ParseNbpGoldPrices parses the response of the NBP gold price API
func ParseNbpGoldPrices(content []byte) ([]DatedPrice, error) {
	var items []*nbpGoldPrice
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()

	if err := decoder.Decode(&items); err != nil {
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	prices := make([]DatedPrice, 0, len(items))

	for _, item := range items {
		if item == nil || models.ValidateAssetPriceDate(item.Date) != nil {
			continue
		}

		if _, err := models.ParseAssetPrice(item.Price.String()); err != nil {
			continue
		}

		prices = append(prices, DatedPrice{Date: item.Date, Price: item.Price.String()})
	}

	return prices, nil
}

type coinGeckoMarketCoin struct {
	Id           string       `json:"id"`
	CurrentPrice *json.Number `json:"current_price"`
}

// ParseCoinGeckoMarkets parses the response of the CoinGecko coins/markets API, returns the price (decimal string) by CoinGecko id
func ParseCoinGeckoMarkets(content []byte) (map[string]string, error) {
	var items []*coinGeckoMarketCoin
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()

	if err := decoder.Decode(&items); err != nil {
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	prices := make(map[string]string, len(items))

	for _, item := range items {
		if item == nil || item.Id == "" || item.CurrentPrice == nil {
			continue
		}

		price := strings.TrimSpace(item.CurrentPrice.String())

		// json.Number may be in the exponent format (e.g. 1.2e-7), ParseAssetPrice supports it
		if _, err := models.ParseAssetPrice(price); err != nil {
			continue
		}

		prices[item.Id] = price
	}

	return prices, nil
}

func buildNbpGoldPriceUrl(r DateRange) string {
	return fmt.Sprintf(nbpGoldPriceUrlFormat, r.Start, r.End)
}

func buildCoinGeckoMarketsUrl(vsCurrency string) string {
	return fmt.Sprintf(coinGeckoMarketsUrlFormat, strings.ToLower(vsCurrency))
}
