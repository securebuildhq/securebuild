package pipeline

import (
	"errors"
	"time"
)

var ErrPipelineNotFound = errors.New("pipeline not found")

// PipelineType represents the type of pipeline
type PipelineType string

const (
	TypePackage PipelineType = "package"
	TypeImage   PipelineType = "image"
)

// Pipeline represents a reusable package or image pipeline configuration
type Pipeline struct {
	ID          string
	Type        PipelineType
	Path        string // e.g., "test/smoke-binary" or "build/autoconf"
	YAMLContent string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
