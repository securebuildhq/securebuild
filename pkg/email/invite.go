package email

import (
	"context"
	"fmt"

	"github.com/keighl/postmark"
)

// SendInviteEmail sends a team invitation email
func SendInviteEmail(ctx context.Context, toEmail, teamName, inviteURL string) error {
	if client == nil {
		return fmt.Errorf("email service not initialized")
	}

	email := postmark.Email{
		From:    "noreply@securebuild.com",
		To:      toEmail,
		Subject: fmt.Sprintf("You've been invited to join %s on SecureBuild", teamName),
		HtmlBody: fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Team Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #0d9488 0%%, #14b8a6 100%%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">SecureBuild</h1>
    </div>

    <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <h2 style="color: #1f2937; margin-top: 0; margin-bottom: 20px;">You've been invited to join %s</h2>

        <p style="margin-bottom: 20px; color: #6b7280;">
            You've been invited to join the <strong>%s</strong> team on SecureBuild, the secure package building platform.
        </p>

        <p style="margin-bottom: 30px; color: #6b7280;">
            Click the button below to accept your invitation and start collaborating with your team:
        </p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="%s" style="background: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block; transition: background-color 0.3s;">
                Accept Invitation
            </a>
        </div>

        <p style="color: #9ca3af; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            If you can't click the button above, copy and paste this link into your browser:<br>
            <a href="%s" style="color: #0d9488; word-break: break-all;">%s</a>
        </p>

        <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
            If you didn't expect this invitation, you can safely ignore this email.
        </p>
    </div>
</body>
</html>`, teamName, teamName, inviteURL, inviteURL, inviteURL),
		TextBody: fmt.Sprintf(`You've been invited to join %s on SecureBuild

You've been invited to join the %s team on SecureBuild, the secure package building platform.

Accept your invitation by visiting: %s

If you didn't expect this invitation, you can safely ignore this email.`, teamName, teamName, inviteURL),
	}

	_, err := client.SendEmail(email)
	if err != nil {
		return fmt.Errorf("failed to send email via Postmark: %w", err)
	}

	return nil
}
