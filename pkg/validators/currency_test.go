package validators

import (
	"testing"

	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
)

func TestValidCurrency(t *testing.T) {
	validate := validator.New()
	err := validate.RegisterValidation("validCurrency", ValidCurrency)
	assert.Nil(t, err)

	err = validate.Var("CNY", "validCurrency")
	assert.Nil(t, err)

	err = validate.Var("USD", "validCurrency")
	assert.Nil(t, err)

	err = validate.Var("---", "validCurrency")
	assert.Nil(t, err)
}

func TestInvalidCurrency(t *testing.T) {
	validate := validator.New()
	err := validate.RegisterValidation("validCurrency", ValidCurrency)
	assert.Nil(t, err)

	err = validate.Var("XXX", "validCurrency")
	assert.NotNil(t, err)

	err = validate.Var("RMB", "validCurrency")
	assert.NotNil(t, err)

	err = validate.Var("", "validCurrency")
	assert.NotNil(t, err)

	err = validate.Var("-", "validCurrency")
	assert.NotNil(t, err)
}

func TestValidAssetOrCurrency(t *testing.T) {
	validate := validator.New()
	err := validate.RegisterValidation("validAssetOrCurrency", ValidAssetOrCurrency)
	assert.Nil(t, err)

	for _, code := range []string{"PLN", "XAU", "XAG", "BTC", "USDT", "---"} {
		assert.Nil(t, validate.Var(code, "validAssetOrCurrency"), code)
	}

	for _, code := range []string{"XXX", "FOO", "", "btc"} {
		assert.NotNil(t, validate.Var(code, "validAssetOrCurrency"), code)
	}

	// default currency validator must keep rejecting assets
	err = validate.RegisterValidation("validCurrency", ValidCurrency)
	assert.Nil(t, err)
	assert.NotNil(t, validate.Var("BTC", "validCurrency"))
}
