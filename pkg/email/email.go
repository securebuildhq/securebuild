package email

import (
	"context"
	"fmt"

	"github.com/keighl/postmark"
	"github.com/securebuildhq/securebuild/pkg/param"
)

var (
	client *postmark.Client
)

// Init initializes the email service with Postmark
func Init(ctx context.Context) error {
	if param.GetParam(ctx).PostmarkServerToken == "" {
		return fmt.Errorf("POSTMARK_SERVER_TOKEN is required")
	}

	client = postmark.NewClient(param.GetParam(ctx).PostmarkServerToken, "")
	return nil
}
