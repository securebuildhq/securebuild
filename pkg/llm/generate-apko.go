package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
)

const (
	TextEditor_Sonnet37 = "text_editor_20250124"

	Model_Sonnet37 = "claude-3-7-sonnet-20250219"
)

func GenerateAPKOFromMelanage(ctx context.Context, melanageYaml string) (string, error) {
	client, err := newAnthropicClient(ctx)
	if err != nil {
		return "", err
	}

	messages := []anthropic.MessageParam{
		anthropic.NewAssistantMessage(anthropic.NewTextBlock(generateApkoSystemPrompt)),
		anthropic.NewAssistantMessage(anthropic.NewTextBlock(
			fmt.Sprintf(secureBuildApkRepositoryFormatString,
				param.GetParam(ctx).ApkRepository,
			),
		),
		),
		anthropic.NewAssistantMessage(anthropic.NewTextBlock(valideApkoFields)),
	}

	messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock(strings.TrimSpace(melanageYaml))))

	toolInputSchema := anthropic.ToolInputSchemaParam{
		Type: constant.Object("object"),
		Properties: map[string]interface{}{
			"command": map[string]interface{}{
				"type": "string",
				"enum": []string{"view", "str_replace", "create"},
			},
			"path": map[string]interface{}{
				"type": "string",
			},
			"old_str": map[string]interface{}{
				"type": "string",
			},
			"new_str": map[string]interface{}{
				"type": "string",
			},
		},
	}
	tools := []anthropic.ToolUnionParam{
		anthropic.ToolUnionParamOfTool(toolInputSchema, TextEditor_Sonnet37),
	}

	thinkingDisabled := anthropic.NewThinkingConfigDisabledParam()
	thinkingParam := anthropic.ThinkingConfigParamUnion{OfDisabled: &thinkingDisabled}

	updatedContent := ""

	for {
		stream := client.Messages.NewStreaming(ctx, anthropic.MessageNewParams{
			Model:     anthropic.Model(Model_Sonnet37),
			MaxTokens: 8192,
			Messages:  messages,
			Tools:     tools,
			Thinking:  thinkingParam,
		})

		message := anthropic.Message{}
		for stream.Next() {
			event := stream.Current()
			err := message.Accumulate(event)
			if err != nil {
				return "", err
			}

			switch ev := event.AsAny().(type) {
			case anthropic.ContentBlockDeltaEvent:
				delta := ev.Delta.AsAny()
				if textDelta, ok := delta.(anthropic.TextDelta); ok && textDelta.Text != "" {
					fmt.Printf("%s", textDelta.Text)
				}
			}
		}

		if stream.Err() != nil {
			return "", stream.Err()
		}

		messages = append(messages, message.ToParam())

		hasToolCalls := false
		toolResults := []anthropic.ContentBlockParamUnion{}

		for _, block := range message.Content {
			toolUse, ok := block.AsAny().(anthropic.ToolUseBlock)
			if !ok {
				continue
			}
			hasToolCalls = true
			var response interface{}

			var input struct {
				Command string `json:"command"`
				Path    string `json:"path"`
				OldStr  string `json:"old_str"`
				NewStr  string `json:"new_str"`
			}

			if err := json.Unmarshal(toolUse.Input, &input); err != nil {
				return "", err
			}

			logger.Info("LLM text_editor tool use",
				zap.String("command", input.Command),
				zap.String("path", input.Path),
				zap.Int("old_str_len", len(input.OldStr)),
				zap.Int("new_str_len", len(input.NewStr)))

			if input.Command == "view" {
				response = "Error: File does not exist. Use create instead."
			} else if input.Command == "str_replace" {
				response = "Error: File does not exist. Use create instead."
			} else if input.Command == "create" {
				updatedContent = input.NewStr
				response = "Created"
			}

			b, err := json.Marshal(response)
			if err != nil {
				return "", err
			}

			toolResults = append(toolResults, anthropic.NewToolResultBlock(toolUse.ID, string(b), false))
		}

		if !hasToolCalls {
			break
		}

		messages = append(messages, anthropic.NewUserMessage(toolResults...))
	}

	return updatedContent, nil
}
