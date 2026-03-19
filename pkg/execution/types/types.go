package types

import "time"

type Execution struct {
	ID                    string     `json:"id"`
	CreatedAt             time.Time  `json:"created_at"`
	PackageID             string     `json:"package_id"`
	VersionLabel          string     `json:"version_label"`
	Status                string     `json:"status"`
	BuildStdout           string     `json:"build_stdout"`
	BuildStderr           string     `json:"build_stderr"`
	BuildExitCode         int        `json:"build_exit_code"`
	BuildCommand          string     `json:"build_command"`
	PublishOutput         string     `json:"publish_output"`
	X86_64BuildStartedAt  *time.Time `json:"x86_64_build_started_at"`
	Aarch64BuildStartedAt *time.Time `json:"aarch64_build_started_at"`
}

type ExecutionStatus string

const (
	ExecutionStatusNone         ExecutionStatus = "none"
	ExecutionStatusPending      ExecutionStatus = "pending"
	ExecutionStatusProvisioning ExecutionStatus = "provisioning"
	ExecutionStatusQueued       ExecutionStatus = "queued"
	ExecutionStatusBuilding     ExecutionStatus = "building"
	ExecutionStatusTesting      ExecutionStatus = "testing"
	ExecutionStatusPublishing   ExecutionStatus = "publishing"
	ExecutionStatusSuccess      ExecutionStatus = "success"
	ExecutionStatusFailed       ExecutionStatus = "failed"
	ExecutionStatusVMDeleted    ExecutionStatus = "vm_deleted"
)
