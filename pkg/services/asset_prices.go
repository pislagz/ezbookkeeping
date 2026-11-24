package services

import (
	"sort"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/datastore"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/models"
)

// AssetPricesService represents asset price history service
type AssetPricesService struct {
	ServiceUsingDB
}

// Initialize an asset price service singleton instance
var (
	AssetPrices = &AssetPricesService{
		ServiceUsingDB: ServiceUsingDB{
			container: datastore.Container,
		},
	}
)

// GetLatestPrices returns the latest price (the one with the greatest date) of every asset which has a price
func (s *AssetPricesService) GetLatestPrices(c core.Context, uid int64) (map[string]*models.AssetPrice, error) {
	if uid <= 0 {
		return nil, errs.ErrUserIdInvalid
	}

	if err := s.MigrateLegacyPrices(c, uid); err != nil {
		return nil, err
	}

	result := make(map[string]*models.AssetPrice)
	for _, asset := range core.AllAssets {
		var prices []*models.AssetPrice
		err := s.UserDataDB(uid).NewSession(c).Where("uid=? AND asset=?", uid, asset.Code).OrderBy("date desc").Limit(1).Find(&prices)

		if err != nil {
			return nil, err
		}

		if len(prices) > 0 {
			result[asset.Code] = prices[0]
		}
	}

	return result, nil
}

// GetPriceSeries returns the prices of an asset between two dates (inclusive, both optional) ordered by date ascending
func (s *AssetPricesService) GetPriceSeries(c core.Context, uid int64, asset string, startDate string, endDate string) ([]*models.AssetPrice, error) {
	if uid <= 0 {
		return nil, errs.ErrUserIdInvalid
	}

	if err := s.MigrateLegacyPrices(c, uid); err != nil {
		return nil, err
	}

	sess := s.UserDataDB(uid).NewSession(c).Where("uid=? AND asset=?", uid, asset)

	if startDate != "" {
		sess = sess.And("date>=?", startDate)
	}

	if endDate != "" {
		sess = sess.And("date<=?", endDate)
	}

	var prices []*models.AssetPrice
	err := sess.OrderBy("date asc").Find(&prices)

	return prices, err
}

// HasAnyPrice returns whether the user has at least one price (any source) of the asset
func (s *AssetPricesService) HasAnyPrice(c core.Context, uid int64, asset string) (bool, error) {
	if uid <= 0 {
		return false, errs.ErrUserIdInvalid
	}

	count, err := s.UserDataDB(uid).NewSession(c).Where("uid=? AND asset=?", uid, asset).Count(&models.AssetPrice{})

	return count > 0, err
}

// SaveManualPrice inserts or replaces the price of an asset on a date, the price becomes a manual one
func (s *AssetPricesService) SaveManualPrice(c core.Context, uid int64, asset string, date string, price int64) (*models.AssetPrice, error) {
	if uid <= 0 {
		return nil, errs.ErrUserIdInvalid
	}

	now := time.Now().Unix()
	newPrice := &models.AssetPrice{
		Uid:             uid,
		Asset:           asset,
		Date:            date,
		Price:           price,
		Source:          string(models.ASSET_PRICE_SOURCE_MANUAL),
		SourceName:      models.AssetPriceSourceNameManual,
		CreatedUnixTime: now,
		UpdatedUnixTime: now,
	}

	err := s.UserDataDB(uid).DoTransaction(c, func(sess datastore.DatabaseSession) error {
		old := &models.AssetPrice{}
		has, err := sess.Where("uid=? AND asset=? AND date=?", uid, asset, date).Get(old)

		if err != nil {
			return err
		}

		if has {
			newPrice.CreatedUnixTime = old.CreatedUnixTime
			_, err = sess.Where("uid=? AND asset=? AND date=?", uid, asset, date).Cols("price", "source", "source_name", "updated_unix_time").Update(newPrice)
			return err
		}

		_, err = sess.Insert(newPrice)
		return err
	})

	if err != nil {
		return nil, err
	}

	return newPrice, nil
}

// DeletePrice deletes the price of an asset on a date
func (s *AssetPricesService) DeletePrice(c core.Context, uid int64, asset string, date string) error {
	if uid <= 0 {
		return errs.ErrUserIdInvalid
	}

	return s.UserDataDB(uid).DoTransaction(c, func(sess datastore.DatabaseSession) error {
		deleted, err := sess.Where("uid=? AND asset=? AND date=?", uid, asset, date).Delete(&models.AssetPrice{})

		if err != nil {
			return err
		} else if deleted < 1 {
			return errs.ErrAssetPriceNotFound
		}

		return nil
	})
}

// DeleteAllPrices deletes all asset prices of the user
func (s *AssetPricesService) DeleteAllPrices(c core.Context, uid int64) error {
	if uid <= 0 {
		return errs.ErrUserIdInvalid
	}

	return s.UserDataDB(uid).DoTransaction(c, func(sess datastore.DatabaseSession) error {
		_, err := sess.Where("uid=?", uid).Delete(&models.AssetPrice{})
		return err
	})
}

// SaveAutoPrices saves the automatically fetched prices of one asset, a manual price of the same date is never overwritten.
// It returns the count of inserted or updated rows.
func (s *AssetPricesService) SaveAutoPrices(c core.Context, uid int64, asset string, sourceName string, prices []*models.AssetPrice) (int, error) {
	if uid <= 0 {
		return 0, errs.ErrUserIdInvalid
	}

	if len(prices) < 1 {
		return 0, nil
	}

	sort.Slice(prices, func(i, j int) bool { return prices[i].Date < prices[j].Date })
	minDate := prices[0].Date
	maxDate := prices[len(prices)-1].Date
	now := time.Now().Unix()
	count := 0

	err := s.UserDataDB(uid).DoTransaction(c, func(sess datastore.DatabaseSession) error {
		var oldPrices []*models.AssetPrice
		err := sess.Where("uid=? AND asset=? AND date>=? AND date<=?", uid, asset, minDate, maxDate).Find(&oldPrices)

		if err != nil {
			return err
		}

		existing := make(map[string]*models.AssetPrice, len(oldPrices))

		for _, old := range oldPrices {
			existing[old.Date] = old
		}

		incoming := make([]*models.AssetPrice, 0, len(prices))

		for _, price := range prices {
			incoming = append(incoming, &models.AssetPrice{
				Uid:             uid,
				Asset:           asset,
				Date:            price.Date,
				Price:           price.Price,
				Source:          string(models.ASSET_PRICE_SOURCE_AUTO),
				SourceName:      sourceName,
				CreatedUnixTime: now,
				UpdatedUnixTime: now,
			})
		}

		toInsert, toUpdate := models.PlanAutoAssetPriceWrites(existing, incoming)

		for _, price := range toInsert {
			if _, err = sess.Insert(price); err != nil {
				return err
			}
		}

		for _, price := range toUpdate {
			_, err = sess.Where("uid=? AND asset=? AND date=? AND source=?", uid, asset, price.Date, string(models.ASSET_PRICE_SOURCE_AUTO)).Cols("price", "source_name", "updated_unix_time").Update(price)

			if err != nil {
				return err
			}
		}

		count = len(toInsert) + len(toUpdate)
		return nil
	})

	return count, err
}

// MigrateLegacyPrices moves the asset prices which PR #1 stored in the user custom exchange rate table into the history as manual prices
// (dated by the time they were saved). A legacy price never overwrites a price of the history. The legacy rows are marked as deleted.
func (s *AssetPricesService) MigrateLegacyPrices(c core.Context, uid int64) error {
	if uid <= 0 {
		return errs.ErrUserIdInvalid
	}

	var legacyRates []*models.UserCustomExchangeRate
	err := s.UserDataDB(uid).NewSession(c).Where("uid=? AND deleted_unix_time=?", uid, 0).Find(&legacyRates)

	if err != nil {
		return err
	}

	legacyAssetRates := make([]*models.UserCustomExchangeRate, 0)

	for _, rate := range legacyRates {
		if core.IsAsset(rate.Currency) {
			legacyAssetRates = append(legacyAssetRates, rate)
		}
	}

	if len(legacyAssetRates) < 1 {
		return nil
	}

	now := time.Now().Unix()

	return s.UserDataDB(uid).DoTransaction(c, func(sess datastore.DatabaseSession) error {
		for _, rate := range legacyAssetRates {
			updatedTime := rate.UpdatedUnixTime

			if updatedTime <= 0 {
				updatedTime = now
			}

			date := time.Unix(updatedTime, 0).UTC().Format(models.AssetPriceDateFormat)
			count, err := sess.Where("uid=? AND asset=? AND date=?", uid, rate.Currency, date).Count(&models.AssetPrice{})

			if err != nil {
				return err
			}

			// the legacy price is converted from price * 10^8 to price * 10^10
			price := rate.Rate * (models.AssetPriceFactorInDatabase / models.UserCustomExchangeRateFactorInDatabase)

			if count < 1 && price > 0 {
				_, err = sess.Insert(&models.AssetPrice{
					Uid:             uid,
					Asset:           rate.Currency,
					Date:            date,
					Price:           price,
					Source:          string(models.ASSET_PRICE_SOURCE_MANUAL),
					SourceName:      models.AssetPriceSourceNameManual,
					CreatedUnixTime: now,
					UpdatedUnixTime: now,
				})

				if err != nil {
					return err
				}
			}

			_, err = sess.Cols("deleted_unix_time").Where("uid=? AND deleted_unix_time=? AND currency=?", uid, 0, rate.Currency).Update(&models.UserCustomExchangeRate{DeletedUnixTime: now})

			if err != nil {
				return err
			}
		}

		return nil
	})
}
