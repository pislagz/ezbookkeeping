package api

import (
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/assetprices"
	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/services"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

// AssetPricesApi represents asset price api
type AssetPricesApi struct {
	ApiUsingConfig
	users       *services.UserService
	assetPrices *services.AssetPricesService
}

// Initialize an asset price api singleton instance
var (
	AssetPrices = &AssetPricesApi{
		ApiUsingConfig: ApiUsingConfig{
			container: settings.Container,
		},
		users:       services.Users,
		assetPrices: services.AssetPrices,
	}
)

// AssetPriceLatestHandler returns the latest price of every asset which has a price
func (a *AssetPricesApi) AssetPriceLatestHandler(c *core.WebContext) (any, *errs.Error) {
	uid := c.GetCurrentUid()
	latestPrices, err := a.assetPrices.GetLatestPrices(c, uid)

	if err != nil {
		log.Errorf(c, "[asset_prices.AssetPriceLatestHandler] failed to get latest asset prices for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	result := make([]*models.AssetPriceInfoResponse, 0, len(latestPrices))

	for _, asset := range core.AllAssets {
		if price, exists := latestPrices[asset.Code]; exists {
			result = append(result, price.ToAssetPriceInfoResponse())
		}
	}

	return result, nil
}

// AssetPriceSeriesHandler returns the price series ([{date, price, source}] ordered by date) of an asset in a date range
func (a *AssetPricesApi) AssetPriceSeriesHandler(c *core.WebContext) (any, *errs.Error) {
	var req models.AssetPriceSeriesRequest
	err := c.ShouldBindQuery(&req)

	if err != nil {
		log.Warnf(c, "[asset_prices.AssetPriceSeriesHandler] parse request failed, because %s", err.Error())
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}

	if err = models.ValidateAsset(req.Asset); err != nil {
		return nil, errs.Or(err, errs.ErrAssetInvalid)
	}

	for _, date := range []string{req.StartDate, req.EndDate} {
		if date != "" && models.ValidateAssetPriceDate(date) != nil {
			return nil, errs.ErrAssetPriceDateInvalid
		}
	}

	uid := c.GetCurrentUid()
	prices, err := a.assetPrices.GetPriceSeries(c, uid, req.Asset, req.StartDate, req.EndDate)

	if err != nil {
		log.Errorf(c, "[asset_prices.AssetPriceSeriesHandler] failed to get price series of \"%s\" for user \"uid:%d\", because %s", req.Asset, uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	result := make([]*models.AssetPriceSeriesItem, 0, len(prices))

	for _, price := range prices {
		result = append(result, price.ToAssetPriceSeriesItem())
	}

	return result, nil
}

// AssetPriceSaveHandler saves a manual price of an asset on a date (it replaces an automatic price of the same date)
func (a *AssetPricesApi) AssetPriceSaveHandler(c *core.WebContext) (any, *errs.Error) {
	var req models.AssetPriceSaveRequest
	err := c.ShouldBindJSON(&req)

	if err != nil {
		log.Warnf(c, "[asset_prices.AssetPriceSaveHandler] parse request failed, because %s", err.Error())
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}

	if err = models.ValidateAsset(req.Asset); err != nil {
		return nil, errs.Or(err, errs.ErrAssetInvalid)
	}

	if err = models.ValidateAssetPriceDate(req.Date); err != nil {
		return nil, errs.Or(err, errs.ErrAssetPriceDateInvalid)
	}

	// allow tomorrow in UTC, so that every timezone can enter its "today"
	if req.Date > time.Now().UTC().AddDate(0, 0, 1).Format(models.AssetPriceDateFormat) {
		return nil, errs.ErrAssetPriceDateInvalid
	}

	price, err := models.ParseAssetPrice(req.Price)

	if err != nil {
		return nil, errs.Or(err, errs.ErrAssetPriceInvalid)
	}

	uid := c.GetCurrentUid()
	saved, err := a.assetPrices.SaveManualPrice(c, uid, req.Asset, req.Date, price)

	if err != nil {
		log.Errorf(c, "[asset_prices.AssetPriceSaveHandler] failed to save price of \"%s\" for user \"uid:%d\", because %s", req.Asset, uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	log.Infof(c, "[asset_prices.AssetPriceSaveHandler] user \"uid:%d\" has saved manual price of \"%s\" on \"%s\"", uid, req.Asset, req.Date)
	return saved.ToAssetPriceInfoResponse(), nil
}

// AssetPriceDeleteHandler deletes the price of an asset on a date
func (a *AssetPricesApi) AssetPriceDeleteHandler(c *core.WebContext) (any, *errs.Error) {
	var req models.AssetPriceDeleteRequest
	err := c.ShouldBindJSON(&req)

	if err != nil {
		log.Warnf(c, "[asset_prices.AssetPriceDeleteHandler] parse request failed, because %s", err.Error())
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}

	if err = models.ValidateAsset(req.Asset); err != nil {
		return nil, errs.Or(err, errs.ErrAssetInvalid)
	}

	if err = models.ValidateAssetPriceDate(req.Date); err != nil {
		return nil, errs.Or(err, errs.ErrAssetPriceDateInvalid)
	}

	uid := c.GetCurrentUid()
	err = a.assetPrices.DeletePrice(c, uid, req.Asset, req.Date)

	if err != nil {
		log.Errorf(c, "[asset_prices.AssetPriceDeleteHandler] failed to delete price of \"%s\" for user \"uid:%d\", because %s", req.Asset, uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	log.Infof(c, "[asset_prices.AssetPriceDeleteHandler] user \"uid:%d\" has deleted price of \"%s\" on \"%s\"", uid, req.Asset, req.Date)
	return true, nil
}

// AssetPriceAutoUpdateHandler fetches the public prices of the assets which the user holds (cached for one hour on the server).
// It is called by the client when the app is opened, only if the user did not disable it.
func (a *AssetPricesApi) AssetPriceAutoUpdateHandler(c *core.WebContext) (any, *errs.Error) {
	uid := c.GetCurrentUid()
	user, err := a.users.GetUserById(c, uid)

	if err != nil {
		log.Errorf(c, "[asset_prices.AssetPriceAutoUpdateHandler] failed to get user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	return assetprices.DefaultUpdater.Update(c, a.CurrentConfig(), uid, user.DefaultCurrency), nil
}
