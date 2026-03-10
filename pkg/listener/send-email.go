package listener

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/email"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/team"
	"go.uber.org/zap"
)

type SendEmailPayload struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
}

func handleSendEmail(ctx context.Context, payload string) error {
	var sendEmailPayload SendEmailPayload
	if err := json.Unmarshal([]byte(payload), &sendEmailPayload); err != nil {
		return fmt.Errorf("failed to unmarshal send email payload: %w", err)
	}

	logger.Debug("handleSendEmail", zap.String("event", sendEmailPayload.Event))

	switch sendEmailPayload.Event {
	case "invite_team_member":
		return handleInviteTeamMember(ctx, sendEmailPayload.Data)
	case "partner_info_request":
		return handlePartnerInfoRequest(ctx, sendEmailPayload.Data)
	case "enterprise_info_request":
		return handleEnterpriseInfoRequest(ctx, sendEmailPayload.Data)
	case "magic_link":
		return handleMagicLink(ctx, sendEmailPayload.Data)
	}

	return nil
}

func handleInviteTeamMember(ctx context.Context, data map[string]interface{}) error {
	inviteID := data["invite_id"].(string)

	invite, err := team.GetInvite(ctx, inviteID)
	if err != nil {
		return fmt.Errorf("failed to get invite: %w", err)
	}

	// Get team information for the email
	teamInfo, err := team.GetTeam(ctx, invite.TeamID)
	if err != nil {
		return fmt.Errorf("failed to get team: %w", err)
	}

	// Construct the invite URL - this would typically point to your frontend
	// TODO: Make this configurable via environment variable
	inviteURL := fmt.Sprintf("https://securebuild.com/invite#%s", invite.Token)

	// Send the invitation email
	if err := email.SendInviteEmail(ctx, invite.Email, teamInfo.Name, inviteURL); err != nil {
		return fmt.Errorf("failed to send invite email: %w", err)
	}

	if err := team.SetInviteSent(ctx, inviteID); err != nil {
		return fmt.Errorf("failed to set invite sent: %w", err)
	}
	return nil
}

func handlePartnerInfoRequest(ctx context.Context, data map[string]interface{}) error {
	requestID := data["id"].(string)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var name, emailAddress, projectName string
	var githubUsername, companyName, comments sql.NullString

	query := `select name, email, project_name, github_username, company_name, comments from partner_info_request where id = $1`
	err := conn.QueryRow(ctx, query, requestID).Scan(&name, &emailAddress, &projectName, &githubUsername, &companyName, &comments)
	if err != nil {
		return fmt.Errorf("failed to get partner info request: %w", err)
	}

	if err := email.SendPartnerInfoRequest(ctx, name, emailAddress, projectName, githubUsername.String, companyName.String, comments.String); err != nil {
		return fmt.Errorf("failed to send partner info request email: %w", err)
	}

	return nil
}

func handleEnterpriseInfoRequest(ctx context.Context, data map[string]interface{}) error {
	requestID := data["id"].(string)

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var name, emailAddress, companyName, jobTitle, teamSize string
	var comments sql.NullString

	query := `select name, email, company_name, job_title, team_size, comments from enterprise_info_request where id = $1`
	err := conn.QueryRow(ctx, query, requestID).Scan(&name, &emailAddress, &companyName, &jobTitle, &teamSize, &comments)
	if err != nil {
		return fmt.Errorf("failed to get enterprise info request: %w", err)
	}

	if err := email.SendEnterpriseInfoRequest(ctx, name, emailAddress, companyName, jobTitle, teamSize, comments.String); err != nil {
		return fmt.Errorf("failed to send enterprise info request email: %w", err)
	}

	return nil
}

func handleMagicLink(ctx context.Context, data map[string]interface{}) error {
	emailAddress := data["email"].(string)
	code := data["code"].(string)

	if err := email.SendMagicLinkEmail(ctx, emailAddress, code); err != nil {
		return fmt.Errorf("failed to send magic link email: %w", err)
	}

	return nil
}
