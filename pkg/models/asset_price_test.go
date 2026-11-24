package models

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseAndFormatAssetPrice(t *testing.T) {
	for input, expected := range map[string]string{
		"400000":        "400000",
		"0.0001":        "0.0001",
		"123456.789":    "123456.789",
		"0.00000000015": "0.0000000002",
		"1.50":          "1.5",
	} {
		stored, err := ParseAssetPrice(input)
		assert.Nil(t, err, input)
		assert.Equal(t, expected, FormatAssetPrice(stored), input)
	}

	stored, _ := ParseAssetPrice("400000")
	assert.Equal(t, int64(4000000000000000), stored)
	stored, _ = ParseAssetPrice("0.0001")
	assert.Equal(t, int64(1000000), stored)

	for _, input := range []string{"", "abc", "0", "-1", "99999999999999999999"} {
		_, err := ParseAssetPrice(input)
		assert.NotNil(t, err, input)
	}
}

func TestValidateAssetPriceDate(t *testing.T) {
	assert.Nil(t, ValidateAssetPriceDate("2026-02-28"))
	assert.NotNil(t, ValidateAssetPriceDate("2026-02-30"))
	assert.NotNil(t, ValidateAssetPriceDate("2026-2-3"))
	assert.NotNil(t, ValidateAssetPriceDate("abcdefghij"))
}

func TestPlanAutoAssetPriceWrites_ManualWinsOverAuto(t *testing.T) {
	existing := map[string]*AssetPrice{
		"2026-01-01": {Date: "2026-01-01", Price: 10, Source: "manual"},
		"2026-01-02": {Date: "2026-01-02", Price: 20, Source: "auto"},
		"2026-01-03": {Date: "2026-01-03", Price: 30, Source: "auto"},
	}
	incoming := []*AssetPrice{
		{Date: "2026-01-01", Price: 11, Source: "auto"},
		{Date: "2026-01-02", Price: 21, Source: "auto"},
		{Date: "2026-01-03", Price: 30, Source: "auto"},
		{Date: "2026-01-04", Price: 40, Source: "auto"},
	}

	toInsert, toUpdate := PlanAutoAssetPriceWrites(existing, incoming)

	assert.Equal(t, 1, len(toInsert))
	assert.Equal(t, "2026-01-04", toInsert[0].Date)
	assert.Equal(t, 1, len(toUpdate))
	assert.Equal(t, "2026-01-02", toUpdate[0].Date)
}
