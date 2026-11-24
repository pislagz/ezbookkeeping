package errs

import "net/http"

// Error codes related to asset prices
var (
	ErrAssetPriceNotFound    = NewNormalError(NormalSubcategoryAssetPrice, 0, http.StatusBadRequest, "asset price not found")
	ErrAssetPriceDateInvalid = NewNormalError(NormalSubcategoryAssetPrice, 1, http.StatusBadRequest, "asset price date is invalid")
	ErrAssetPriceInvalid     = NewNormalError(NormalSubcategoryAssetPrice, 2, http.StatusBadRequest, "asset price is invalid")
	ErrAssetInvalid          = NewNormalError(NormalSubcategoryAssetPrice, 3, http.StatusBadRequest, "asset is invalid")
)
