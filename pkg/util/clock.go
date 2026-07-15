package util

import (
	"context"
	"time"
)

// NowFunc returns the current time. Production code uses the default (time.Now);
// tests can inject a fixed clock via WithNowFunc for deterministic time comparisons.
type NowFunc func() time.Time

type nowFuncKey struct{}

// WithNowFunc returns a context carrying a custom now function. Used in tests
// to provide a deterministic reference time.
func WithNowFunc(ctx context.Context, fn NowFunc) context.Context {
	return context.WithValue(ctx, nowFuncKey{}, fn)
}

// GetNowFunc returns the now function from the context if injected,
// otherwise falls back to time.Now.
func GetNowFunc(ctx context.Context) NowFunc {
	if fn, ok := ctx.Value(nowFuncKey{}).(NowFunc); ok {
		return fn
	}
	return time.Now
}
