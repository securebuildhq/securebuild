package package_family

import (
	"database/sql"
	"time"
)

type PackageFamily struct {
	ID                    string         `json:"id" db:"id"`
	Name                  string         `json:"name" db:"name"`
	MonitoringEnabled     bool           `json:"monitoring_enabled" db:"monitoring_enabled"`
	CheckFrequencyMinutes int            `json:"check_frequency_minutes" db:"check_frequency_minutes"`
	VersionPattern        sql.NullString `json:"version_pattern" db:"version_pattern"`
	MajorVersionFilter    sql.NullString `json:"major_version_filter" db:"major_version_filter"`
	PackageNameTemplate   string         `json:"package_name_template" db:"package_name_template"`
	DryRunMode            bool           `json:"dry_run_mode" db:"dry_run_mode"`
	MinVersion            sql.NullString `json:"min_version" db:"min_version"`
	NotifyOnDetection     bool           `json:"notify_on_detection" db:"notify_on_detection"`
	NotifyOnBuildFailure  bool           `json:"notify_on_build_failure" db:"notify_on_build_failure"`
	CheckForUpdatesAt     time.Time      `json:"check_for_updates_at" db:"check_for_updates_at"`
	LastCheckAt           sql.NullTime   `json:"last_check_at" db:"last_check_at"`
	LastError             sql.NullString `json:"last_error" db:"last_error"`
	ConsecutiveErrors     int            `json:"consecutive_errors" db:"consecutive_errors"`
	CreatedAt             time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at" db:"updated_at"`
	ImageTagTemplate      sql.NullString `json:"image_tag_template" db:"image_tag_template"`
	GitRemote             sql.NullString `json:"git_remote" db:"git_remote"`
	MelangeFilePath       sql.NullString `json:"melange_file_path" db:"melange_file_path"`
	InitialTag            sql.NullString `json:"initial_tag" db:"initial_tag"`
}
