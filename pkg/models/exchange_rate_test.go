package models

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLatestExchangeRateSliceLess(t *testing.T) {
	var latestExchangeRateSlice LatestExchangeRateSlice
	latestExchangeRateSlice = append(latestExchangeRateSlice, &LatestExchangeRate{
		Currency: "USD",
	})
	latestExchangeRateSlice = append(latestExchangeRateSlice, &LatestExchangeRate{
		Currency: "EUR",
	})
	latestExchangeRateSlice = append(latestExchangeRateSlice, &LatestExchangeRate{
		Currency: "CNY",
	})

	sort.Sort(latestExchangeRateSlice)

	assert.Equal(t, "CNY", latestExchangeRateSlice[0].Currency)
	assert.Equal(t, "EUR", latestExchangeRateSlice[1].Currency)
	assert.Equal(t, "USD", latestExchangeRateSlice[2].Currency)
}

func TestCreateUserAssetPrice(t *testing.T) {
	rate, err := CreateUserAssetPrice(1, "BTC", "400123.45")
	assert.Nil(t, err)
	assert.Equal(t, int64(40012345000000), rate.Rate)
	assert.InDelta(t, 400123.45, rate.ToAssetPrice(), 1e-6)

	rate, err = CreateUserAssetPrice(1, "XAU", "512.3456")
	assert.Nil(t, err)
	assert.InDelta(t, 512.3456, rate.ToAssetPrice(), 1e-8)

	_, err = CreateUserAssetPrice(1, "PLN", "1")
	assert.NotNil(t, err)
	_, err = CreateUserAssetPrice(1, "BTC", "0")
	assert.NotNil(t, err)
	_, err = CreateUserAssetPrice(1, "BTC", "-1")
	assert.NotNil(t, err)
	_, err = CreateUserAssetPrice(1, "BTC", "x")
	assert.NotNil(t, err)
}
