package core

import (
	"fmt"
	"math"
	"math/big"
)

// GramsPerTroyOunce is the number of grams in one troy ounce
const GramsPerTroyOunce = 31.1034768

// AssetKind represents the kind of an asset "currency"
type AssetKind byte

// Asset kinds
const (
	ASSET_KIND_METAL  AssetKind = 1
	ASSET_KIND_CRYPTO AssetKind = 2
)

// DefaultAmountScale is the number of decimal places that every normal (ISO 4217) currency amount is stored with in database (amount * 10^2)
const DefaultAmountScale = 2

// AssetInfo represents the information of an asset (precious metal or crypto currency) which can be used as an account currency
type AssetInfo struct {
	// Code is the asset code stored in the currency field, e.g. XAU, BTC
	Code string
	// Kind is metal or crypto
	Kind AssetKind
	// Scale is the number of decimals which an amount is stored with, the stored int64 = amount (in whole unit) * 10^Scale.
	// For metals the whole unit is one gram, for crypto assets it is one coin.
	Scale int
	// DisplayDecimals is the default maximum number of decimals which is displayed
	DisplayDecimals int
	// CoinGeckoId is the id of the asset in CoinGecko (crypto only), reserved for automatic price fetching
	CoinGeckoId string
}

// AllAssets contains all supported assets, ordered by the display order
var AllAssets = []*AssetInfo{
	// Metals: internal unit is gram, stored in 0.01 g
	{Code: "XAU", Kind: ASSET_KIND_METAL, Scale: 2, DisplayDecimals: 2},
	{Code: "XAG", Kind: ASSET_KIND_METAL, Scale: 2, DisplayDecimals: 2},
	// Crypto
	{Code: "BTC", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "bitcoin"},
	{Code: "ETH", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "ethereum"},
	{Code: "SOL", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "solana"},
	{Code: "USDT", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "tether"},
	{Code: "USDC", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "usd-coin"},
	{Code: "XRP", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "ripple"},
	{Code: "ADA", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "cardano"},
	{Code: "DOGE", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "dogecoin"},
	{Code: "DOT", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "polkadot"},
	{Code: "LTC", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "litecoin"},
	{Code: "BNB", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "binancecoin"},
	{Code: "AVAX", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "avalanche-2"},
	{Code: "LINK", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "chainlink"},
	{Code: "XMR", Kind: ASSET_KIND_CRYPTO, Scale: 8, DisplayDecimals: 8, CoinGeckoId: "monero"},
	{Code: "TRX", Kind: ASSET_KIND_CRYPTO, Scale: 6, DisplayDecimals: 6, CoinGeckoId: "tron"},
}

var assetsByCode = func() map[string]*AssetInfo {
	m := make(map[string]*AssetInfo, len(AllAssets))

	for _, asset := range AllAssets {
		m[asset.Code] = asset
	}

	return m
}()

// GetAssetInfo returns the asset information by code, or nil if the code is not an asset
func GetAssetInfo(code string) *AssetInfo {
	return assetsByCode[code]
}

// IsAsset returns whether the code is a supported asset (precious metal or crypto currency)
func IsAsset(code string) bool {
	_, exists := assetsByCode[code]
	return exists
}

// GetAmountScale returns the number of decimals which amounts of the currency are stored with
func GetAmountScale(code string) int {
	if asset, exists := assetsByCode[code]; exists {
		return asset.Scale
	}

	return DefaultAmountScale
}

// MaxStoredAmount is the max absolute stored value allowed by the transaction amount limitation (same for all scales)
const MaxStoredAmount = int64(999999999999999)

// ParseAssetAmount parses a decimal text (e.g. "0.00123456") to the stored int64 amount of the asset
// It returns an error when the text has more decimals than the asset scale (to guarantee exact round-trip) or exceeds the limitation
func ParseAssetAmount(code string, text string) (int64, error) {
	scale := GetAmountScale(code)
	value, ok := new(big.Rat).SetString(text)

	if !ok {
		return 0, fmt.Errorf("invalid amount \"%s\"", text)
	}

	factor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil)
	value.Mul(value, new(big.Rat).SetInt(factor))

	if !value.IsInt() {
		return 0, fmt.Errorf("amount \"%s\" has more than %d decimals", text, scale)
	}

	num := value.Num()
	limit := big.NewInt(MaxStoredAmount)

	if num.CmpAbs(limit) > 0 {
		return 0, fmt.Errorf("amount \"%s\" exceeds limitation", text)
	}

	return num.Int64(), nil
}

// FormatAssetAmount formats a stored int64 amount of the asset to a decimal text with all decimals of the asset scale (e.g. "0.00123456")
func FormatAssetAmount(code string, amount int64) string {
	scale := GetAmountScale(code)
	negative := amount < 0
	abs := new(big.Int).Abs(big.NewInt(amount))
	text := abs.String()

	if scale > 0 {
		for len(text) <= scale {
			text = "0" + text
		}

		text = text[:len(text)-scale] + "." + text[len(text)-scale:]
	}

	if negative {
		text = "-" + text
	}

	return text
}

// GramsToTroyOunces converts grams to troy ounces
func GramsToTroyOunces(grams float64) float64 {
	return grams / GramsPerTroyOunce
}

// TroyOuncesToGrams converts troy ounces to grams
func TroyOuncesToGrams(ounces float64) float64 {
	return ounces * GramsPerTroyOunce
}

// TroyOuncesToStoredMetalAmount converts troy ounces to the stored amount of a metal (0.01 g units), rounded to nearest
func TroyOuncesToStoredMetalAmount(ounces float64) int64 {
	return int64(math.Round(TroyOuncesToGrams(ounces) * math.Pow10(DefaultAmountScale)))
}

// StoredMetalAmountToTroyOunces converts the stored amount of a metal (0.01 g units) to troy ounces
func StoredMetalAmountToTroyOunces(amount int64) float64 {
	return GramsToTroyOunces(float64(amount) / math.Pow10(DefaultAmountScale))
}
