package services

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/datastore"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

// newMigrationTestDatabase opens a temporary sqlite database, the test is skipped when sqlite is not available (CGO_ENABLED=0)
func newMigrationTestDatabase(t *testing.T) (*DataMigrationsService, datastore.Database) {
	db, err := datastore.NewDatabase(&settings.DatabaseConfig{
		DatabaseType: settings.Sqlite3DbType,
		DatabasePath: filepath.Join(t.TempDir(), "migration.db"),
	})

	if err != nil {
		t.Skipf("sqlite is not available: %s", err.Error())
	}

	if err = db.SyncStructs(new(models.Account), new(models.Transaction), new(models.TransactionTemplate), new(models.DataMigration)); err != nil {
		t.Skipf("sqlite is not available: %s", err.Error())
	}

	dataStore, err := datastore.NewDataStore(db)
	assert.Nil(t, err)

	return NewDataMigrationsService(&datastore.DataStoreContainer{UserDataStore: dataStore}), db
}

func insertMigrationTestData(t *testing.T, db datastore.Database) {
	limit := int64(500000)

	sess := db.NewSession(core.NewNullContext())

	for _, account := range []*models.Account{
		{AccountId: 1, Uid: 1, Name: "PLN", Currency: "PLN", Balance: 1000000},
		{AccountId: 2, Uid: 1, Name: "gold", Currency: "XAU", Balance: 3110 + 1555},
		{AccountId: 3, Uid: 1, Name: "silver", Currency: "XAG", Balance: 50000, Deleted: true, Extend: &models.AccountExtend{CreditCardLimit: &limit}},
		{AccountId: 4, Uid: 1, Name: "BTC", Currency: "BTC", Balance: 123456},
	} {
		_, err := sess.Insert(account)
		assert.Nil(t, err)
	}

	for _, transaction := range []*models.Transaction{
		{TransactionId: 10, Uid: 1, AccountId: 2, TransactionTime: 10, Amount: 3110},                                                                    // income to gold
		{TransactionId: 11, Uid: 1, AccountId: 2, TransactionTime: 11, Amount: 1555, Deleted: true},                                                     // deleted rows are scaled too
		{TransactionId: 12, Uid: 1, AccountId: 1, TransactionTime: 12, Amount: -500000, RelatedId: 13, RelatedAccountId: 2, RelatedAccountAmount: 1555}, // transfer PLN -> gold (out row)
		{TransactionId: 13, Uid: 1, AccountId: 2, TransactionTime: 13, Amount: 1555, RelatedId: 12, RelatedAccountId: 1, RelatedAccountAmount: -500000}, // transfer PLN -> gold (in row)
		{TransactionId: 14, Uid: 1, AccountId: 2, TransactionTime: 14, Amount: -100, RelatedId: 15, RelatedAccountId: 3, RelatedAccountAmount: 100},     // gold -> silver (both metals)
		{TransactionId: 15, Uid: 1, AccountId: 3, TransactionTime: 15, Amount: 100, RelatedId: 14, RelatedAccountId: 2, RelatedAccountAmount: -100},
		{TransactionId: 16, Uid: 1, AccountId: 4, TransactionTime: 16, Amount: 123456}, // BTC is never scaled
		{TransactionId: 17, Uid: 1, AccountId: 1, TransactionTime: 17, Amount: 777},
	} {
		_, err := sess.Insert(transaction)
		assert.Nil(t, err)
	}

	for _, template := range []*models.TransactionTemplate{
		{TemplateId: 20, Uid: 1, AccountId: 2, Amount: 3110, TagIds: ""},
		{TemplateId: 21, Uid: 1, AccountId: 1, Amount: -500000, RelatedAccountId: 2, RelatedAccountAmount: 1555, TagIds: ""},
		{TemplateId: 22, Uid: 1, AccountId: 4, Amount: 5, TagIds: ""},
	} {
		_, err := sess.Insert(template)
		assert.Nil(t, err)
	}
}

func TestMigrateMetalAmountScale(t *testing.T) {
	service, db := newMigrationTestDatabase(t)
	insertMigrationTestData(t, db)

	migrated, err := service.MigrateMetalAmountScale(core.NewNullContext())
	assert.Nil(t, err)
	assert.True(t, migrated)

	sess := db.NewSession(core.NewNullContext())

	balances := map[int64]int64{}
	var accounts []*models.Account
	assert.Nil(t, sess.Find(&accounts))

	for _, account := range accounts {
		balances[account.AccountId] = account.Balance

		if account.AccountId == 3 {
			assert.NotNil(t, account.Extend)
			assert.Equal(t, int64(5000000000), *account.Extend.CreditCardLimit)
		}
	}

	assert.Equal(t, map[int64]int64{1: 1000000, 2: (3110 + 1555) * 10000, 3: 50000 * 10000, 4: 123456}, balances)

	amounts := map[int64][2]int64{}
	var transactions []*models.Transaction
	assert.Nil(t, sess.Find(&transactions))

	for _, transaction := range transactions {
		amounts[transaction.TransactionId] = [2]int64{transaction.Amount, transaction.RelatedAccountAmount}
	}

	assert.Equal(t, map[int64][2]int64{
		10: {31100000, 0},
		11: {15550000, 0},
		12: {-500000, 15550000}, // the related amount is in gold, the amount is in PLN
		13: {15550000, -500000},
		14: {-1000000, 1000000},
		15: {1000000, -1000000},
		16: {123456, 0},
		17: {777, 0},
	}, amounts)

	templates := map[int64][2]int64{}
	var templateRows []*models.TransactionTemplate
	assert.Nil(t, sess.Find(&templateRows))

	for _, template := range templateRows {
		templates[template.TemplateId] = [2]int64{template.Amount, template.RelatedAccountAmount}
	}

	assert.Equal(t, map[int64][2]int64{20: {31100000, 0}, 21: {-500000, 15550000}, 22: {5, 0}}, templates)

	// the second run must not scale again
	migrated, err = service.MigrateMetalAmountScale(core.NewNullContext())
	assert.Nil(t, err)
	assert.False(t, migrated)

	account := &models.Account{}
	has, err := sess.ID(int64(2)).Get(account)
	assert.Nil(t, err)
	assert.True(t, has)
	assert.Equal(t, int64((3110+1555)*10000), account.Balance)
}

func TestMigrateMetalAmountScale_OverflowRollsBack(t *testing.T) {
	service, db := newMigrationTestDatabase(t)

	sess := db.NewSession(core.NewNullContext())

	_, err := sess.Insert(&models.Account{AccountId: 1, Uid: 1, Name: "ok", Currency: "XAU", Balance: 100})
	assert.Nil(t, err)
	_, err = sess.Insert(&models.Account{AccountId: 2, Uid: 1, Name: "huge", Currency: "XAU", Balance: 9000000000000000000})
	assert.Nil(t, err)

	migrated, err := service.MigrateMetalAmountScale(core.NewNullContext())
	assert.NotNil(t, err)
	assert.False(t, migrated)

	// nothing was changed, and no marker was written, so it can be retried
	account := &models.Account{}
	_, err = sess.ID(int64(1)).Get(account)
	assert.Nil(t, err)
	assert.Equal(t, int64(100), account.Balance)

	exists, err := sess.Exist(&models.DataMigration{Name: MetalAmountScaleMigrationName})
	assert.Nil(t, err)
	assert.False(t, exists)
}

func TestScaleAmount(t *testing.T) {
	scaled, err := scaleAmount(3110, 10000, "x")
	assert.Nil(t, err)
	assert.Equal(t, int64(31100000), scaled)

	scaled, err = scaleAmount(-1555, 10000, "x")
	assert.Nil(t, err)
	assert.Equal(t, int64(-15550000), scaled)

	scaled, err = scaleAmount(0, 10000, "x")
	assert.Nil(t, err)
	assert.Equal(t, int64(0), scaled)

	_, err = scaleAmount(9000000000000000, 10000, "x")
	assert.NotNil(t, err)
}
