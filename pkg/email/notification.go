package email

import (
	"context"
	"fmt"
	"time"

	"github.com/keighl/postmark"
)

// SendNotificationEmail sends an image update notification email
func SendNotificationEmail(ctx context.Context, emailAddress, eventType, imageName, imageTag, imageDigest string, previousDigest *string, timestamp time.Time) error {
	if client == nil {
		return fmt.Errorf("email client not initialized")
	}

	// Create event type display text
	var eventDisplay string
	switch eventType {
	case "tag_updated":
		eventDisplay = "Tag Updated (repushed due to vulnerability fixed)"
	case "new_tag":
		eventDisplay = "New Tag Available"
	case "cve_found":
		eventDisplay = "CVE Found in SecureBuild Image"
	default:
		eventDisplay = eventType
	}

	// Create subject
	subject := fmt.Sprintf("SecureBuild: %s for %s:%s", eventDisplay, imageName, imageTag)

	// Create HTML body
	htmlBody := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%s</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #0d9488 0%%, #14b8a6 100%%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">SecureBuild</h1>
    </div>

    <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <h2 style="color: #1f2937; margin-top: 0; margin-bottom: 20px;">%s</h2>

        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #374151;">Image Details</h3>
            <ul style="margin: 10px 0; padding-left: 20px; color: #6b7280;">
                <li><strong>Image:</strong> %s</li>
                <li><strong>Tag:</strong> %s</li>
                <li><strong>Digest:</strong> <code style="background: #e5e7eb; padding: 2px 4px; border-radius: 3px; font-size: 12px;">%s</code></li>
                %s
                <li><strong>Timestamp:</strong> %s</li>
            </ul>
        </div>

        <p style="color: #6b7280; margin-bottom: 30px;">
            This notification was sent because you have configured email notifications for this image in your SecureBuild account.
        </p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="https://securebuild.com/dashboard" style="background: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
                View in Dashboard
            </a>
        </div>

        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            SecureBuild - Secure your software supply chain
        </p>
    </div>
</body>
</html>`, eventDisplay, eventDisplay, imageName, imageTag, imageDigest,
		func() string {
			if previousDigest != nil {
				return fmt.Sprintf(`<li><strong>Previous Digest:</strong> <code style="background: #e5e7eb; padding: 2px 4px; border-radius: 3px; font-size: 12px;">%s</code></li>`, *previousDigest)
			}
			return ""
		}(), timestamp.Format("January 2, 2006 at 3:04 PM MST"))

	// Create text body
	textBody := fmt.Sprintf(`%s

Image Details:
- Image: %s
- Tag: %s
- Digest: %s
%s- Timestamp: %s

This notification was sent because you have configured email notifications for this image in your SecureBuild account.

View in Dashboard: https://securebuild.com/dashboard

--
SecureBuild - Secure your software supply chain`, eventDisplay, imageName, imageTag, imageDigest,
		func() string {
			if previousDigest != nil {
				return fmt.Sprintf("- Previous Digest: %s\n", *previousDigest)
			}
			return ""
		}(), timestamp.Format("January 2, 2006 at 3:04 PM MST"))

	email := postmark.Email{
		From:     "noreply@securebuild.com",
		To:       emailAddress,
		Subject:  subject,
		HtmlBody: htmlBody,
		TextBody: textBody,
		Tag:      "notification",
	}

	_, err := client.SendEmail(email)
	if err != nil {
		return fmt.Errorf("failed to send notification email via Postmark: %w", err)
	}

	return nil
}
