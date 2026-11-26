package models

// DataMigration represents a one-time data migration (not a table structure change) which has been applied to the database, table "data_migration"
type DataMigration struct {
	Name            string `xorm:"PK VARCHAR(64)"`
	AppliedUnixTime int64
}
