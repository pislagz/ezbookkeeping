package services

import (
	"fmt"
	"math"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/datastore"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/models"
)

// MetalAmountScaleMigrationName is the name of the migration which changed the stored scale of precious metals from 0.01 g to 0.000001 g
const MetalAmountScaleMigrationName = "metal_amount_scale_6"

const metalMigrationBatchSize = 500

// DataMigrationsService represents the service which applies one-time data migrations
type DataMigrationsService struct {
	ServiceUsingDB
}

// Initialize a data migrations service singleton instance
var (
	DataMigrations = &DataMigrationsService{
		ServiceUsingDB: ServiceUsingDB{
			container: datastore.Container,
		},
	}
)

// NewDataMigrationsService returns a data migrations service using the specified data storage container
func NewDataMigrationsService(container *datastore.DataStoreContainer) *DataMigrationsService {
	return &DataMigrationsService{
		ServiceUsingDB: NewServiceUsingDB(container),
	}
}

// MigrateMetalAmountScale multiplies every stored amount of precious metals (XAU, XAG) by 10^(MetalAmountScale-LegacyMetalAmountScale).
// It runs once per database in a single transaction together with the migration marker, so running it again does nothing.
// The "data_migration" table must exist. It returns whether any database has been migrated.
func (s *DataMigrationsService) MigrateMetalAmountScale(c core.Context) (bool, error) {
	migrated := false

	for i := 0; i < s.UserDataDBCount(); i++ {
		done, err := s.migrateMetalAmountScaleInDatabase(c, s.UserDataDBByIndex(i))

		if err != nil {
			return migrated, err
		}

		migrated = migrated || done
	}

	return migrated, nil
}

func (s *DataMigrationsService) migrateMetalAmountScaleInDatabase(c core.Context, db datastore.Database) (bool, error) {
	migrated := false

	err := db.DoTransaction(c, func(sess datastore.DatabaseSession) error {
		exists, err := sess.Exist(&models.DataMigration{Name: MetalAmountScaleMigrationName})

		if err != nil {
			return err
		}

		if exists {
			return nil
		}

		factor := int64(math.Pow10(core.MetalAmountScale - core.LegacyMetalAmountScale))
		accountIds, err := s.scaleMetalAccounts(sess, factor)

		if err != nil {
			return err
		}

		transactionCount := 0
		templateCount := 0

		for start := 0; start < len(accountIds); start += metalMigrationBatchSize {
			end := start + metalMigrationBatchSize

			if end > len(accountIds) {
				end = len(accountIds)
			}

			batch := make([]any, 0, end-start)

			for _, accountId := range accountIds[start:end] {
				batch = append(batch, accountId)
			}

			count, err := s.scaleMetalTransactions(sess, batch, factor)

			if err != nil {
				return err
			}

			transactionCount += count

			count, err = s.scaleMetalTemplates(sess, batch, factor)

			if err != nil {
				return err
			}

			templateCount += count
		}

		_, err = sess.Insert(&models.DataMigration{Name: MetalAmountScaleMigrationName, AppliedUnixTime: time.Now().Unix()})

		if err != nil {
			return err
		}

		log.Infof(c, "[data_migrations.migrateMetalAmountScaleInDatabase] scaled amounts of %d metal accounts, %d transaction rows and %d templates by %d", len(accountIds), transactionCount, templateCount, factor)
		migrated = true
		return nil
	})

	return migrated, err
}

// scaleAmount multiplies the amount, an amount which would exceed the limitation is an error (the migration is rolled back)
func scaleAmount(amount int64, factor int64, what string) (int64, error) {
	if amount == 0 {
		return 0, nil
	}

	scaled := amount * factor

	if scaled/factor != amount {
		return 0, fmt.Errorf("the metal amount %d of %s is too large to be scaled", amount, what)
	}

	return scaled, nil
}

func (s *DataMigrationsService) scaleMetalAccounts(sess datastore.DatabaseSession, factor int64) ([]int64, error) {
	var accounts []*models.Account
	err := sess.In("currency", core.GetMetalCodesAsArgs()...).Find(&accounts)

	if err != nil {
		return nil, err
	}

	accountIds := make([]int64, 0, len(accounts))

	for _, account := range accounts {
		accountIds = append(accountIds, account.AccountId)

		balance, err := scaleAmount(account.Balance, factor, fmt.Sprintf("account %d", account.AccountId))

		if err != nil {
			return nil, err
		}

		cols := []string{"balance"}
		update := &models.Account{Balance: balance}

		if account.Extend != nil && account.Extend.CreditCardLimit != nil {
			limit, err := scaleAmount(*account.Extend.CreditCardLimit, factor, fmt.Sprintf("the credit card limit of account %d", account.AccountId))

			if err != nil {
				return nil, err
			}

			extend := *account.Extend
			extend.CreditCardLimit = &limit
			update.Extend = &extend
			cols = append(cols, "extend")
		}

		_, err = sess.ID(account.AccountId).Cols(cols...).Update(update)

		if err != nil {
			return nil, err
		}
	}

	return accountIds, nil
}

// scaleMetalTransactions scales Amount of the rows of the metal accounts, and RelatedAccountAmount of the rows whose related account is a metal account
// (deleted rows are included)
func (s *DataMigrationsService) scaleMetalTransactions(sess datastore.DatabaseSession, accountIds []any, factor int64) (int, error) {
	count := 0

	var rows []*models.Transaction
	err := sess.In("account_id", accountIds...).Find(&rows)

	if err != nil {
		return 0, err
	}

	for _, row := range rows {
		amount, err := scaleAmount(row.Amount, factor, fmt.Sprintf("transaction %d", row.TransactionId))

		if err != nil {
			return 0, err
		}

		if _, err = sess.ID(row.TransactionId).Cols("amount").Update(&models.Transaction{Amount: amount}); err != nil {
			return 0, err
		}

		count++
	}

	rows = nil
	err = sess.In("related_account_id", accountIds...).Find(&rows)

	if err != nil {
		return 0, err
	}

	for _, row := range rows {
		amount, err := scaleAmount(row.RelatedAccountAmount, factor, fmt.Sprintf("transaction %d", row.TransactionId))

		if err != nil {
			return 0, err
		}

		if _, err = sess.ID(row.TransactionId).Cols("related_account_amount").Update(&models.Transaction{RelatedAccountAmount: amount}); err != nil {
			return 0, err
		}

		count++
	}

	return count, nil
}

// scaleMetalTemplates does the same as scaleMetalTransactions for the transaction templates (including the scheduled ones)
func (s *DataMigrationsService) scaleMetalTemplates(sess datastore.DatabaseSession, accountIds []any, factor int64) (int, error) {
	count := 0

	var rows []*models.TransactionTemplate
	err := sess.In("account_id", accountIds...).Find(&rows)

	if err != nil {
		return 0, err
	}

	for _, row := range rows {
		amount, err := scaleAmount(row.Amount, factor, fmt.Sprintf("template %d", row.TemplateId))

		if err != nil {
			return 0, err
		}

		if _, err = sess.ID(row.TemplateId).Cols("amount").Update(&models.TransactionTemplate{Amount: amount}); err != nil {
			return 0, err
		}

		count++
	}

	rows = nil
	err = sess.In("related_account_id", accountIds...).Find(&rows)

	if err != nil {
		return 0, err
	}

	for _, row := range rows {
		amount, err := scaleAmount(row.RelatedAccountAmount, factor, fmt.Sprintf("template %d", row.TemplateId))

		if err != nil {
			return 0, err
		}

		if _, err = sess.ID(row.TemplateId).Cols("related_account_amount").Update(&models.TransactionTemplate{RelatedAccountAmount: amount}); err != nil {
			return 0, err
		}

		count++
	}

	return count, nil
}
