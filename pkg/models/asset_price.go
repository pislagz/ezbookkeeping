package models

import (
	"math/big"
	"strings"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
)

// AssetPriceFactorInDatabase is the factor which a price is multiplied by when it is stored (price * 10^10, int64).
// 400000 PLN (BTC) is stored as 4e15 and 0.0001 PLN as 1000000, both exactly; the int64 limit is about 922,000,000 PLN per unit.
const AssetPriceFactorInDatabase = int64(10000000000)

const assetPriceFactorDecimals = 10

// AssetPriceDateFormat is the format of the date of an asset price
const AssetPriceDateFormat = "2006-01-02"

// AssetPriceSource represents how an asset price was created
type AssetPriceSource string

// Asset price sources
const (
	ASSET_PRICE_SOURCE_AUTO   AssetPriceSource = "auto"
	ASSET_PRICE_SOURCE_MANUAL AssetPriceSource = "manual"
)

// Asset price source names
const (
	AssetPriceSourceNameManual    = "manual"
	AssetPriceSourceNameNBP       = "nbp"
	AssetPriceSourceNameCoinGecko = "coingecko"
)

// AssetPrice represents the price of one asset (one gram of metal or one coin) on a date, in the default currency of the user.
// The date is a plain calendar date (YYYY-MM-DD) without a timezone: prices from NBP use the date published by NBP (Poland),
// prices from CoinGecko use the UTC date of the fetch, manual prices use the date which the user entered.
// There is only one price per (user, asset, date): a manual price always wins over an automatic one.
type AssetPrice struct {
	Uid             int64  `xorm:"PK NOT NULL"`
	Asset           string `xorm:"PK VARCHAR(10) NOT NULL"`
	Date            string `xorm:"PK VARCHAR(10) NOT NULL"`
	Price           int64  `xorm:"NOT NULL"`
	Source          string `xorm:"VARCHAR(10) NOT NULL"`
	SourceName      string `xorm:"VARCHAR(20) NOT NULL"`
	CreatedUnixTime int64
	UpdatedUnixTime int64
}

// AssetPriceSaveRequest represents all parameters of manual asset price saving request
type AssetPriceSaveRequest struct {
	Asset string `json:"asset" binding:"required,min=3,max=10"`
	Date  string `json:"date" binding:"required,len=10"`
	Price string `json:"price" binding:"required"`
}

// AssetPriceDeleteRequest represents all parameters of asset price deleting request
type AssetPriceDeleteRequest struct {
	Asset string `json:"asset" binding:"required,min=3,max=10"`
	Date  string `json:"date" binding:"required,len=10"`
}

// AssetPriceSeriesRequest represents all parameters of asset price series request
type AssetPriceSeriesRequest struct {
	Asset     string `form:"asset" binding:"required,min=3,max=10"`
	StartDate string `form:"startDate"`
	EndDate   string `form:"endDate"`
}

// AssetPriceInfoResponse represents a view-object of an asset price
type AssetPriceInfoResponse struct {
	Asset      string `json:"asset"`
	Date       string `json:"date"`
	Price      string `json:"price"`
	Source     string `json:"source"`
	SourceName string `json:"sourceName"`
	UpdateTime int64  `json:"updateTime"`
}

// AssetPriceSeriesItem represents a point of the price series of an asset
type AssetPriceSeriesItem struct {
	Date       string `json:"date"`
	Price      string `json:"price"`
	Source     string `json:"source"`
	SourceName string `json:"sourceName"`
}

// AssetPriceAutoUpdateResponse represents the result of an automatic update of asset prices
type AssetPriceAutoUpdateResponse struct {
	Enabled      bool     `json:"enabled"`
	UpdatedAsset []string `json:"updatedAssets"`
	SavedCount   int      `json:"savedCount"`
	Offline      bool     `json:"offline"`
}

// ParseAssetPrice converts a decimal price string (default currency per unit) to the stored int64, rounding half up at the 10th decimal
func ParseAssetPrice(price string) (int64, error) {
	value, ok := new(big.Rat).SetString(strings.TrimSpace(price))

	if !ok || value.Sign() <= 0 {
		return 0, errs.ErrAssetPriceInvalid
	}

	value.Mul(value, new(big.Rat).SetInt64(AssetPriceFactorInDatabase))
	value.Add(value, big.NewRat(1, 2))
	scaled := new(big.Int).Quo(value.Num(), value.Denom())

	if !scaled.IsInt64() || scaled.Sign() <= 0 {
		return 0, errs.ErrAssetPriceInvalid
	}

	return scaled.Int64(), nil
}

// FormatAssetPrice converts the stored int64 to an exact decimal string without trailing zeros
func FormatAssetPrice(stored int64) string {
	negative := stored < 0

	if negative {
		stored = -stored
	}

	integer := stored / AssetPriceFactorInDatabase
	fraction := stored % AssetPriceFactorInDatabase

	result := new(big.Int).SetInt64(integer).String()

	if fraction > 0 {
		digits := new(big.Int).SetInt64(fraction + AssetPriceFactorInDatabase).String()[1:] // zero padded to the decimals
		result += "." + strings.TrimRight(digits, "0")
	}

	if negative {
		return "-" + result
	}

	return result
}

// ToFloat64 returns the price as float64 (only for calculating exchange rates)
func (p *AssetPrice) ToFloat64() float64 {
	return float64(p.Price) / float64(AssetPriceFactorInDatabase)
}

// ToAssetPriceInfoResponse returns a view-object according to database model
func (p *AssetPrice) ToAssetPriceInfoResponse() *AssetPriceInfoResponse {
	return &AssetPriceInfoResponse{
		Asset:      p.Asset,
		Date:       p.Date,
		Price:      FormatAssetPrice(p.Price),
		Source:     p.Source,
		SourceName: p.SourceName,
		UpdateTime: p.UpdatedUnixTime,
	}
}

// ToAssetPriceSeriesItem returns a series item according to database model
func (p *AssetPrice) ToAssetPriceSeriesItem() *AssetPriceSeriesItem {
	return &AssetPriceSeriesItem{
		Date:       p.Date,
		Price:      FormatAssetPrice(p.Price),
		Source:     p.Source,
		SourceName: p.SourceName,
	}
}

// ValidateAssetPriceDate checks the date is a valid YYYY-MM-DD calendar date
func ValidateAssetPriceDate(date string) error {
	parsed, err := time.Parse(AssetPriceDateFormat, date)

	if err != nil || parsed.Format(AssetPriceDateFormat) != date {
		return errs.ErrAssetPriceDateInvalid
	}

	return nil
}

// ValidateAsset checks the code is a supported asset
func ValidateAsset(asset string) error {
	if !core.IsAsset(asset) {
		return errs.ErrAssetInvalid
	}

	return nil
}

// PlanAutoAssetPriceWrites decides which automatic prices should be inserted or updated, according to the existing rows of the same asset.
// A manual price is never overwritten by an automatic one, an unchanged automatic price is not written again.
func PlanAutoAssetPriceWrites(existing map[string]*AssetPrice, incoming []*AssetPrice) (toInsert []*AssetPrice, toUpdate []*AssetPrice) {
	for _, price := range incoming {
		old, exists := existing[price.Date]

		if !exists {
			toInsert = append(toInsert, price)
		} else if old.Source == string(ASSET_PRICE_SOURCE_AUTO) && (old.Price != price.Price || old.SourceName != price.SourceName) {
			toUpdate = append(toUpdate, price)
		}
	}

	return toInsert, toUpdate
}
