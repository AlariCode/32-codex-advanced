package user

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

type MCPToken struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

type CreatedMCPToken struct {
	MCPToken
	Token string `json:"token"`
}

func (s *Service) CreateMCPToken(ctx context.Context, owner string) (CreatedMCPToken, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return CreatedMCPToken{}, err
	}
	token := "lb_mcp_" + base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256([]byte(token))
	out := CreatedMCPToken{MCPToken: MCPToken{ID: newID()}, Token: token}
	err := s.db.QueryRowContext(ctx, `INSERT INTO mcp_tokens(id,user_id,token_hash) VALUES($1,$2,$3) RETURNING created_at`, out.ID, owner, digest[:]).Scan(&out.CreatedAt)
	return out, err
}

func (s *Service) ListMCPTokens(ctx context.Context, owner string) ([]MCPToken, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id::text,created_at FROM mcp_tokens WHERE user_id=$1 ORDER BY created_at DESC,id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MCPToken{}
	for rows.Next() {
		var token MCPToken
		if err := rows.Scan(&token.ID, &token.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, token)
	}
	return out, rows.Err()
}

func (s *Service) RevokeMCPToken(ctx context.Context, owner, id string) error {
	// Idempotent and owner-scoped: foreign and missing IDs reveal nothing.
	_, err := s.db.ExecContext(ctx, `DELETE FROM mcp_tokens WHERE user_id=$1 AND id=$2`, owner, id)
	return err
}

func (s *Service) MCPTokenOwner(ctx context.Context, token string) (string, error) {
	if len(token) != 50 || token[:7] != "lb_mcp_" {
		return "", ErrInvalidCredentials
	}
	secret, err := base64.RawURLEncoding.DecodeString(token[7:])
	if err != nil || len(secret) != 32 || base64.RawURLEncoding.EncodeToString(secret) != token[7:] {
		return "", ErrInvalidCredentials
	}
	digest := sha256.Sum256([]byte(token))
	var owner string
	err = s.db.QueryRowContext(ctx, `SELECT user_id::text FROM mcp_tokens WHERE token_hash=$1`, digest[:]).Scan(&owner)
	return owner, err
}
