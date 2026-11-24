package models

import (
	"math/big"
	"strings"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/utils"
)

const UserCustomExchangeRateFactorInDatabase = int64(100000000)

// UserCustomExchangeRate represents user custom exchange rate data
type UserCustomExchangeRate struct {
	Uid             int64  `xorm:"PK NOT NULL"`
	DeletedUnixTime int64  `xorm:"PK NOT NULL"`
	Currency        string `xorm:"PK VARCHAR(10) NOT NULL"`
	Rate            int64  `xorm:"NOT NULL"`
	CreatedUnixTime int64
	UpdatedUnixTime int64
}

// UserCustomExchangeRateUpdateRequest represents all parameters of user custom exchange rate data updating request
type UserCustomExchangeRateUpdateRequest struct {
	Currency string `json:"currency" binding:"required,min=3,max=10,validAssetOrCurrency"`
	Rate     string `json:"rate"`
}

// UserCustomExchangeRateDeleteRequest represents all parameters of user custom exchange rate data deleting request
type UserCustomExchangeRateDeleteRequest struct {
	Currency string `json:"currency" binding:"required,min=3,max=10,validAssetOrCurrency"`
}

// UserCustomExchangeRateUpdateResponse represents a view-object of the result of updating user custom exchange rate data
type UserCustomExchangeRateUpdateResponse struct {
	LatestExchangeRate
	UpdateTime int64 `json:"updateTime"`
}

// LatestExchangeRateResponse returns a view-object which contains latest exchange rate
type LatestExchangeRateResponse struct {
	DataSource    string                  `json:"dataSource"`
	ReferenceUrl  string                  `json:"referenceUrl"`
	UpdateTime    int64                   `json:"updateTime"`
	BaseCurrency  string                  `json:"baseCurrency"`
	ExchangeRates LatestExchangeRateSlice `json:"exchangeRates"`
}

// LatestExchangeRate represents a data pair of currency and exchange rate
type LatestExchangeRate struct {
	Currency string `json:"currency"`
	Rate     string `json:"rate"`
}

// ToLatestExchangeRate returns a data pair of currency and exchange rate according to database model
func (r *UserCustomExchangeRate) ToLatestExchangeRate(baseCurrencyRate int64) *LatestExchangeRate {
	rate := float64(0)

	if baseCurrencyRate > 0 {
		rate = float64(r.Rate) / float64(baseCurrencyRate)
	}

	return &LatestExchangeRate{
		Currency: r.Currency,
		Rate:     utils.Float64ToString(rate),
	}
}

// ToAssetPrice returns the price (in the user's default currency per one whole unit, i.e. one gram or one coin) of an asset row
// For assets (precious metals and crypto currencies) the Rate column stores the price multiplied by UserCustomExchangeRateFactorInDatabase,
// instead of the rate relative to the default currency (which would lose precision for expensive coins like BTC)
func (r *UserCustomExchangeRate) ToAssetPrice() float64 {
	return float64(r.Rate) / float64(UserCustomExchangeRateFactorInDatabase)
}

// CreateUserAssetPrice returns a user custom exchange rate database model for an asset according to the price in default currency per one whole unit
func CreateUserAssetPrice(uid int64, currency string, price string) (*UserCustomExchangeRate, error) {
	value, ok := new(big.Rat).SetString(price)

	if !core.IsAsset(currency) || !ok || value.Sign() <= 0 {
		return nil, errs.ErrNumberInvalid
	}

	value.Mul(value, new(big.Rat).SetInt64(UserCustomExchangeRateFactorInDatabase))
	scaled := new(big.Int).Quo(value.Num(), value.Denom())

	if !scaled.IsInt64() || scaled.Sign() <= 0 {
		return nil, errs.ErrNumberInvalid
	}

	return &UserCustomExchangeRate{
		Uid:      uid,
		Currency: currency,
		Rate:     scaled.Int64(),
	}, nil
}

// ToUserCustomExchangeRateUpdateResponse returns a view-object of the result of updating user custom exchange rate data according to database model
func (r *UserCustomExchangeRate) ToUserCustomExchangeRateUpdateResponse(baseCurrencyRate int64) *UserCustomExchangeRateUpdateResponse {
	return &UserCustomExchangeRateUpdateResponse{
		LatestExchangeRate: *r.ToLatestExchangeRate(baseCurrencyRate),
		UpdateTime:         r.UpdatedUnixTime,
	}
}

// CreateUserCustomExchangeRate returns a user custom exchange rate database model according to currency and rate
func CreateUserCustomExchangeRate(uid int64, currency string, exchangeRate string, baseCurrencyRate int64) (*UserCustomExchangeRate, error) {
	if baseCurrencyRate <= 0 {
		return &UserCustomExchangeRate{
			Uid:      uid,
			Currency: currency,
			Rate:     UserCustomExchangeRateFactorInDatabase,
		}, nil
	}

	rate, err := utils.StringToFloat64(exchangeRate)

	if err != nil {
		return nil, err
	}

	rate = rate * float64(baseCurrencyRate)

	return &UserCustomExchangeRate{
		Uid:      uid,
		Currency: currency,
		Rate:     int64(rate),
	}, nil
}

// LatestExchangeRateSlice represents the slice data structure of LatestExchangeRate
type LatestExchangeRateSlice []*LatestExchangeRate

// Len returns the count of items
func (s LatestExchangeRateSlice) Len() int {
	return len(s)
}

// Swap swaps two items
func (s LatestExchangeRateSlice) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}

// Less reports whether the first item is less than the second one
func (s LatestExchangeRateSlice) Less(i, j int) bool {
	return strings.Compare(s[i].Currency, s[j].Currency) < 0
}
