package email

import (
	"context"
	"fmt"

	"github.com/keighl/postmark"
)

// SendEnterpriseInfoRequest sends an email to notify about a new enterprise info request.
func SendEnterpriseInfoRequest(ctx context.Context, name, email, companyName, jobTitle, teamSize, comments string) error {
	if client == nil {
		return fmt.Errorf("email service not initialized")
	}

	emailToSend := postmark.Email{
		From:    "noreply@securebuild.com",
		To:      "marc@replicated.com,grant@replicated.com",
		Subject: "New Enterprise Info Request",
		HtmlBody: fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Enterprise Info Request</title>
</head>
<body>
    <h1>New Enterprise Info Request</h1>
    <p>A new request for information about the SecureBuild Enterprise Catalog has been submitted.</p>
    <ul>
        <li><strong>Name:</strong> %s</li>
        <li><strong>Email:</strong> %s</li>
        <li><strong>Company:</strong> %s</li>
        <li><strong>Job Title:</strong> %s</li>
        <li><strong>Team Size:</strong> %s</li>
        <li><strong>Comments:</strong><br><pre>%s</pre></li>
    </ul>
</body>
</html>`, name, email, companyName, jobTitle, teamSize, comments),
		TextBody: fmt.Sprintf(`
A new request for information about the SecureBuild Enterprise Catalog has been submitted.

Name: %s
Email: %s
Company: %s
Job Title: %s
Team Size: %s
Comments:
%s
`, name, email, companyName, jobTitle, teamSize, comments),
	}

	_, err := client.SendEmail(emailToSend)
	if err != nil {
		return fmt.Errorf("failed to send email via Postmark: %w", err)
	}

	return nil
}
