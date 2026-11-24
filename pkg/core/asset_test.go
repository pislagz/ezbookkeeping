package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAllAssets_CodesAreUniqueAndScaleFitsInt64(t *testing.T) {
	codes := make(map[string]bool)

	for _, asset := range AllAssets {
		assert.False(t, codes[asset.Code], asset.Code)
		codes[asset.Code] = true
		assert.GreaterOrEqual(t, len(asset.Code), 3)
		assert.LessOrEqual(t, len(asset.Code), 10)
		assert.GreaterOrEqual(t, asset.Scale, 2)
		assert.LessOrEqual(t, asset.Scale, 8)
		assert.LessOrEqual(t, asset.DisplayDecimals, asset.Scale)

		if asset.Kind == ASSET_KIND_CRYPTO {
			assert.NotEmpty(t, asset.CoinGeckoId, asset.Code)
		}
	}

	for _, code := range []string{"XAU", "XAG", "BTC", "ETH", "SOL", "USDT", "USDC", "XRP", "ADA", "DOGE", "DOT", "LTC", "BNB", "AVAX", "LINK", "XMR", "TRX"} {
		assert.True(t, IsAsset(code), code)
	}
}

func TestGetAmountScale(t *testing.T) {
	assert.Equal(t, 2, GetAmountScale("PLN"))
	assert.Equal(t, 2, GetAmountScale("JPY"))
	assert.Equal(t, 2, GetAmountScale("XAU"))
	assert.Equal(t, 8, GetAmountScale("BTC"))
	assert.False(t, IsAsset("PLN"))
	assert.Nil(t, GetAssetInfo("PLN"))
}

func TestParseAndFormatAssetAmount_RoundTrip(t *testing.T) {
	for _, tc := range []struct {
		code   string
		text   string
		stored int64
	}{
		{"BTC", "0.00123456", 123456},
		{"BTC", "1.00000001", 100000001},
		{"BTC", "-0.5", -50000000},
		{"BTC", "9999999.99999999", 999999999999999},
		{"XAU", "31.1", 3110},
		{"XAU", "0.01", 1},
		{"DOGE", "12345.123456", 12345123456},
		{"PLN", "12.34", 1234},
	} {
		stored, err := ParseAssetAmount(tc.code, tc.text)
		assert.Nil(t, err, tc.text)
		assert.Equal(t, tc.stored, stored, tc.text)

		formatted := FormatAssetAmount(tc.code, stored)
		again, err := ParseAssetAmount(tc.code, formatted)
		assert.Nil(t, err, formatted)
		assert.Equal(t, stored, again, formatted)
	}

	assert.Equal(t, "0.00123456", FormatAssetAmount("BTC", 123456))
	assert.Equal(t, "-0.00000001", FormatAssetAmount("BTC", -1))
	assert.Equal(t, "0.00", FormatAssetAmount("XAU", 0))
}

func TestParseAssetAmount_Invalid(t *testing.T) {
	_, err := ParseAssetAmount("BTC", "0.123456789") // 9 decimals
	assert.NotNil(t, err)
	_, err = ParseAssetAmount("XAU", "0.001")
	assert.NotNil(t, err)
	_, err = ParseAssetAmount("BTC", "abc")
	assert.NotNil(t, err)
	_, err = ParseAssetAmount("BTC", "10000000") // exceeds limitation
	assert.NotNil(t, err)
}

func TestTroyOunceConversion(t *testing.T) {
	assert.InDelta(t, 31.1034768, TroyOuncesToGrams(1), 1e-9)
	assert.InDelta(t, 1, GramsToTroyOunces(31.1034768), 1e-9)
	assert.Equal(t, int64(3110), TroyOuncesToStoredMetalAmount(1))
	assert.Equal(t, int64(1555), TroyOuncesToStoredMetalAmount(0.5))
	assert.InDelta(t, 1.0, StoredMetalAmountToTroyOunces(3110), 0.001)
}
