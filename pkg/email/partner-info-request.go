package email

import (
	"context"
	"fmt"

	"github.com/keighl/postmark"
)

// SendPartnerInfoRequest sends an email to notify about a new partner info request.
func SendPartnerInfoRequest(ctx context.Context, name, email, projectName, githubUsername, companyName, comments string) error {
	if client == nil {
		return fmt.Errorf("email service not initialized")
	}

	emailToSend := postmark.Email{
		From:    "noreply@securebuild.com",
		To:      "marc@replicated.com,grant@replicated.com",
		Subject: "New Partner Info Request",
		HtmlBody: fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Partner Info Request</title>
</head>
<body>
    <h1>New Partner Info Request</h1>
    <p>A new request for information about the SecureBuild partner program has been submitted.</p>
    <ul>
        <li><strong>Name:</strong> %s</li>
        <li><strong>Email:</strong> %s</li>
        <li><strong>Project Name:</strong> %s</li>
        <li><strong>GitHub Username:</strong> %s</li>
        <li><strong>Company Name:</strong> %s</li>
        <li><strong>Comments:</strong><br><pre>%s</pre></li>
    </ul>
</body>
</html>`, name, email, projectName, githubUsername, companyName, comments),
		TextBody: fmt.Sprintf(`
A new request for information about the SecureBuild partner program has been submitted.

Name: %s
Email: %s
Project Name: %s
GitHub Username: %s
Company Name: %s
Comments:
%s
`, name, email, projectName, githubUsername, companyName, comments),
	}

	_, err := client.SendEmail(emailToSend)
	if err != nil {
		return fmt.Errorf("failed to send email via Postmark: %w", err)
	}

	return nil
}
