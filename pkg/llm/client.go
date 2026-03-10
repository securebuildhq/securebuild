package llm

import (
	"context"
	"fmt"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/securebuildhq/securebuild/pkg/param"
)

func newAnthropicClient(ctx context.Context) (*anthropic.Client, error) {
	if param.GetParam(ctx).AnthropicAPIKey == "" {
		return nil, fmt.Errorf("unable to find Anthropic API key")
	}
	client := anthropic.NewClient(
		option.WithAPIKey(param.GetParam(ctx).AnthropicAPIKey),
	)
	return &client, nil
}
