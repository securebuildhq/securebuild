package email

import (
	"context"
	"fmt"

	"github.com/keighl/postmark"
)

// SendMagicLinkEmail sends a magic link email with a verification code
func SendMagicLinkEmail(ctx context.Context, emailAddress string, code string) error {
	if client == nil {
		return fmt.Errorf("email client not initialized")
	}

	email := postmark.Email{
		From:    "noreply@securebuild.com",
		To:      emailAddress,
		Subject: "Your SecureBuild login code",
		HtmlBody: fmt.Sprintf(`
			<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
				<h2 style="color: #333; margin-bottom: 20px;">Your SecureBuild login code</h2>
				
				<p style="color: #666; font-size: 16px; line-height: 1.5;">
					Use this code to complete your login:
				</p>
				
				<div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
					<span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #333;">%s</span>
				</div>
				
				<p style="color: #666; font-size: 14px; line-height: 1.5;">
					This code will expire in 15 minutes. If you didn't request this code, you can safely ignore this email.
				</p>
				
				<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
				
				<p style="color: #999; font-size: 12px; text-align: center;">
					SecureBuild - Secure your software supply chain
				</p>
			</div>
		`, code),
		TextBody: fmt.Sprintf(`Your SecureBuild login code

Use this code to complete your login: %s

This code will expire in 15 minutes. If you didn't request this code, you can safely ignore this email.

--
SecureBuild - Secure your software supply chain`, code),
		Tag: "magic-link",
	}

	_, err := client.SendEmail(email)
	if err != nil {
		return fmt.Errorf("failed to send magic link email: %w", err)
	}

	return nil
}
