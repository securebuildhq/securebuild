package externalimage

import (
	"errors"
	"fmt"
)

var (
	ErrExternalImageNotFound = errors.New("external image not found")
	ErrFetchSBOM             = errors.New("failed to fetch SBOM")
	ErrNoSBOMDataAvailable   = errors.New("no SBOM data available from registry")
	ErrParseScanResult       = errors.New("failed to parse scan result")
	ErrMarshalScanCounts     = errors.New("failed to marshal scan counts")
	ErrMarshalScanSummary    = errors.New("failed to marshal scan summary")
	ErrSaveScanStatus        = errors.New("failed to save scan status")
	ErrNoScanResultForArch   = errors.New("scan did not return results for this architecture")
	ErrScanExecutionFailed   = errors.New("scan execution failed")
)

// ScanFailureError carries a sentinel reason (for metrics/tagging) and a full
// message for storage (e.g. DB). Error() returns Message so the DB gets the
// detail; Unwrap() returns Reason so errors.Is and ReasonForDatadogMetric work.
type ScanFailureError struct {
	Reason  error  // sentinel for Datadog tag (e.g. ErrParseScanResult)
	Message string // full message stored in DB (e.g. underlying err.Error())
}

func (e *ScanFailureError) Error() string { return e.Message }
func (e *ScanFailureError) Unwrap() error { return e.Reason }

// NewScanFailureError builds a ScanFailureError so the DB gets detail and
// metrics get the correct tag. Use when recording scan failures.
func NewScanFailureError(reason error, detail string) *ScanFailureError {
	return &ScanFailureError{Reason: reason, Message: detail}
}

func ReasonForDatadogMetric(err error) string {
	var reason string

	switch {
	case errors.Is(err, ErrExternalImageNotFound):
		reason = "external_image_not_found"
	case errors.Is(err, ErrFetchSBOM):
		reason = "failed_to_fetch_sbom"
	case errors.Is(err, ErrNoSBOMDataAvailable):
		reason = "no_sbom_data_available"
	case errors.Is(err, ErrParseScanResult):
		reason = "failed_to_parse_scan_result"
	case errors.Is(err, ErrMarshalScanCounts):
		reason = "failed_to_marshal_scan_counts"
	case errors.Is(err, ErrMarshalScanSummary):
		reason = "failed_to_marshal_scan_summary"
	case errors.Is(err, ErrSaveScanStatus):
		reason = "failed_to_save_scan_status"
	case errors.Is(err, ErrNoScanResultForArch):
		reason = "no_scan_result_for_arch"
	case errors.Is(err, ErrScanExecutionFailed):
		reason = "scan_execution_failed"
	default:
		reason = "unknown"
	}

	return fmt.Sprintf("reason:%s", reason)
}
