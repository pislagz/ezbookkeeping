package assetprices

import (
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

type testClock struct{ now time.Time }

func newTestUpdater(server *httptest.Server, clock *testClock) *Updater {
	u := NewUpdater(server.Client())
	u.goldUrl = func(r DateRange) string { return server.URL + "/gold/" + r.Start + "/" + r.End }
	u.marketsUrl = func(vs string) string { return server.URL + "/markets?vs_currency=" + vs }
	u.now = func() time.Time { return clock.now }

	return u
}

func TestGetGoldSeries_BackfillChunksAndCachedForOneHour(t *testing.T) {
	fixture, _ := os.ReadFile("testdata/nbp_gold.json")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write(fixture)
	}))
	defer server.Close()

	clock := &testClock{now: time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)}
	u := newTestUpdater(server, clock)
	c := core.NewNullContext()

	// the first fetch of a user backfills 365 days = 4 requests of at most 93 days
	_, err := u.getGoldSeries(c, true)
	assert.Nil(t, err)
	assert.Equal(t, int32(4), requests.Load())

	// within one hour nothing is requested again, even for a user which needs the backfill
	_, err = u.getGoldSeries(c, false)
	assert.Nil(t, err)
	_, err = u.getGoldSeries(c, true)
	assert.Nil(t, err)
	assert.Equal(t, int32(4), requests.Load())

	// after one hour only the recent days are requested (1 request)
	clock.now = clock.now.Add(61 * time.Minute)
	_, err = u.getGoldSeries(c, false)
	assert.Nil(t, err)
	assert.Equal(t, int32(5), requests.Load())
}

func TestGetGoldSeries_NotFoundChunkIsSkippedAndFailureBacksOff(t *testing.T) {
	var requests atomic.Int32
	status := http.StatusNotFound
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(status)
	}))
	defer server.Close()

	clock := &testClock{now: time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)}
	u := newTestUpdater(server, clock)
	c := core.NewNullContext()

	series, err := u.getGoldSeries(c, false)
	assert.Nil(t, err)
	assert.Equal(t, 0, len(series))

	status = http.StatusInternalServerError
	clock.now = clock.now.Add(2 * time.Hour)
	_, err = u.getGoldSeries(c, false)
	assert.NotNil(t, err)
	count := requests.Load()

	// no retry within the backoff
	clock.now = clock.now.Add(time.Minute)
	_, err = u.getGoldSeries(c, false)
	assert.NotNil(t, err)
	assert.Equal(t, count, requests.Load())
}

func TestGetCryptoPrices_CachedPerCurrencyAndRequestIsFixed(t *testing.T) {
	fixture, _ := os.ReadFile("testdata/coingecko_markets.json")
	var requests atomic.Int32
	var lastQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		lastQuery = r.URL.RawQuery
		w.Write(fixture)
	}))
	defer server.Close()

	clock := &testClock{now: time.Date(2026, 11, 24, 23, 30, 0, 0, time.UTC)}
	u := newTestUpdater(server, clock)
	c := core.NewNullContext()

	prices, date, err := u.getCryptoPrices(c, "PLN")
	assert.Nil(t, err)
	assert.Equal(t, "400123.45", prices["bitcoin"])
	assert.Equal(t, "2026-11-24", date)
	assert.Equal(t, "vs_currency=pln", lastQuery) // only the currency, never the user's coins

	_, _, err = u.getCryptoPrices(c, "PLN")
	assert.Nil(t, err)
	assert.Equal(t, int32(1), requests.Load())

	_, _, err = u.getCryptoPrices(c, "USD")
	assert.Nil(t, err)
	assert.Equal(t, int32(2), requests.Load())
}

func TestNeedsGoldBackfill(t *testing.T) {
	now := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	assert.True(t, NeedsGoldBackfill("", now))
	assert.True(t, NeedsGoldBackfill("2026-11-01", now))
	assert.False(t, NeedsGoldBackfill("2026-11-10", now))
	assert.False(t, NeedsGoldBackfill("2026-11-23", now))
}

// failingTransport fails the test when any request is made
type failingTransport struct {
	t     *testing.T
	calls atomic.Int32
}

func (f *failingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	f.calls.Add(1)
	f.t.Errorf("unexpected outbound request in offline mode: %s", req.URL)
	return nil, assert.AnError
}

func TestUpdate_OfflineModeMakesNoRequest(t *testing.T) {
	transport := &failingTransport{t: t}
	u := NewUpdater(&http.Client{Transport: transport})
	c := core.NewNullContext()

	// the config check comes first: no database access and no network access
	response := u.Update(c, &settings.Config{OfflineMode: true, EnableAssetPricesAutoUpdate: true}, 1, "PLN")

	assert.NotNil(t, response)
	assert.False(t, response.Enabled)
	assert.True(t, response.Offline)
	assert.Empty(t, response.UpdatedAsset)
	assert.Equal(t, 0, response.SavedCount)
	assert.Equal(t, int32(0), transport.calls.Load())
}

func TestGetSeries_OfflineClientIsNeverUsedWhenUpdateIsShortCircuited(t *testing.T) {
	transport := &failingTransport{t: t}
	u := NewUpdater(&http.Client{Transport: transport})

	for _, uid := range []int64{1, 2} {
		u.Update(core.NewNullContext(), &settings.Config{OfflineMode: true}, uid, "USD")
	}

	assert.Equal(t, int32(0), transport.calls.Load())
}
