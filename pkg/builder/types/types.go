package types

import "time"

type CMXVM struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	ExpiresAt *time.Time `json:"expires_at"`
	Status    string     `json:"status"`
	IPAddress string     `json:"direct_ssh_endpoint"`
	Port      int        `json:"direct_ssh_port"`
}

type BuilderVM struct {
	ID string `json:"id"`

	IPAddress  string `json:"ip_address"`
	Port       int    `json:"port"`
	PrivateKey string `json:"-"`

	Username string `json:"username"`

	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`

	Status       string `json:"status"`
	Architecture string `json:"architecture"`

	LastUptime          string     `json:"last_uptime"`
	LastUptimeUpdatedAt *time.Time `json:"last_uptime_updated_at"`
	CleanupLockedAt     *time.Time `json:"cleanup_locked_at"`

	IsOnDemand       bool   `json:"is_on_demand"`
	AssignedTaskType string `json:"assigned_task_type"`
	AssignedTaskID   string `json:"assigned_task_id"`

	// Type is the build backend type: "local", "static", or "cmx"
	Type string `json:"type"`
}

// MachineAssignment represents a row in the machine_assignment table.
type MachineAssignment struct {
	MachineID        string    `json:"machine_id"`
	AssignedTaskType string    `json:"assigned_task_type"`
	AssignedTaskID   string    `json:"assigned_task_id"`
	WorkDir          string    `json:"work_dir"`
	CreatedAt        time.Time `json:"created_at"`
}

type MachinePoolHistory struct {
	ID                string     `json:"id"`
	MachineID         string     `json:"machine_id"`
	CreatedAt         time.Time  `json:"created_at"`
	ExpiresAt         *time.Time `json:"expires_at"`
	PrivateKey        string     `json:"-"`
	Username          string     `json:"username"`
	Status            string     `json:"status"`
	IPAddress         string     `json:"ip_address"`
	Port              int        `json:"port"`
	AssignedTaskType  string     `json:"assigned_task_type"`
	AssignedTaskID    string     `json:"assigned_task_id"`
	Architecture      string     `json:"architecture"`
	DeletedAt         time.Time  `json:"deleted_at"`
	TerminationReason string     `json:"termination_reason"`
	LastCommand       string     `json:"last_command"`
	LastStdout        string     `json:"last_stdout"`
	LastStderr        string     `json:"last_stderr"`
	FailureDetails    string     `json:"failure_details"`
	IsOnDemand        bool       `json:"is_on_demand"`
}

type SSHSession struct {
	ID string

	BuilderID     string
	UserID        string
	UserSessionID string
	SSHPID        int

	CreatedAt time.Time
}
