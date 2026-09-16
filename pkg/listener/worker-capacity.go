package listener

import "context"

// waitForCapacity leaves jobs unclaimed until a handler slot is available. The
// buffered signal covers completion between checking capacity and waiting. A
// signal may be stale, so always recheck capacity before fetching more work.
func (p *queueProcessor) waitForCapacity(ctx context.Context) bool {
	for len(p.workerPool) >= p.maxWorkers {
		select {
		case <-ctx.Done():
			return false
		case <-p.workerAvailable:
		}
	}
	return ctx.Err() == nil
}

func (p *queueProcessor) releaseWorkerSlot() {
	<-p.workerPool
	// Coalesce completions without blocking handlers when no processor waits.
	select {
	case p.workerAvailable <- struct{}{}:
	default:
	}
}
