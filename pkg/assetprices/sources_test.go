package assetprices

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestParseNbpGoldPrices(t *testing.T) {
	content, err := os.ReadFile("testdata/nbp_gold.json")
	assert.Nil(t, err)

	prices, err := ParseNbpGoldPrices(content)
	assert.Nil(t, err)
	assert.Equal(t, []DatedPrice{
		{Date: "2026-11-20", Price: "498.12"},
		{Date: "2026-11-23", Price: "501.5"},
		{Date: "2026-11-24", Price: "503"},
	}, prices)

	_, err = ParseNbpGoldPrices([]byte("404 NotFound - Not Found"))
	assert.NotNil(t, err)
}

func TestParseCoinGeckoMarkets(t *testing.T) {
	content, err := os.ReadFile("testdata/coingecko_markets.json")
	assert.Nil(t, err)

	prices, err := ParseCoinGeckoMarkets(content)
	assert.Nil(t, err)
	assert.Equal(t, "400123.45", prices["bitcoin"])
	assert.Equal(t, "12000", prices["ethereum"])
	assert.Equal(t, "0.0001", prices["tether"])
	assert.Equal(t, "1.2e-7", prices["tiny"])
	_, exists := prices["nullprice"]
	assert.False(t, exists)

	_, err = ParseCoinGeckoMarkets([]byte(`{"status":{"error_code":429}}`))
	assert.NotNil(t, err)
}

func TestSplitDateRange_BackfillOneYearInChunksOf93Days(t *testing.T) {
	end := time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)
	start := end.AddDate(0, 0, -365)

	ranges := SplitDateRange(start, end, nbpMaxDaysPerRequest)

	assert.Equal(t, 4, len(ranges))
	assert.Equal(t, start.Format("2006-01-02"), ranges[0].Start)
	assert.Equal(t, "2026-11-24", ranges[len(ranges)-1].End)

	previousEnd := ""

	for i, r := range ranges {
		s, _ := time.Parse("2006-01-02", r.Start)
		e, _ := time.Parse("2006-01-02", r.End)
		assert.LessOrEqual(t, int(e.Sub(s).Hours()/24)+1, nbpMaxDaysPerRequest)

		if i > 0 {
			p, _ := time.Parse("2006-01-02", previousEnd)
			assert.Equal(t, p.AddDate(0, 0, 1).Format("2006-01-02"), r.Start) // contiguous, no overlap
		}

		previousEnd = r.End
	}
}

func TestSplitDateRange_Edges(t *testing.T) {
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	assert.Equal(t, []DateRange{{Start: "2026-01-01", End: "2026-01-01"}}, SplitDateRange(day, day, 93))
	assert.Nil(t, SplitDateRange(day.AddDate(0, 0, 1), day, 93))
	assert.Equal(t, 1, len(SplitDateRange(day, day.AddDate(0, 0, 92), 93)))
	assert.Equal(t, 2, len(SplitDateRange(day, day.AddDate(0, 0, 93), 93)))
}
