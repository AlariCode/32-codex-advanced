package user

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
)

// Current verifies the same opaque cookie issued by Login, returning public data.
func (service *Service) Current(ctx context.Context, token string) (User, error) {
	secret, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(secret) != 32 || base64.RawURLEncoding.EncodeToString(secret) != token {
		return User{}, ErrInvalidCredentials
	}
	digest := sha256.Sum256([]byte(token))
	var current User
	err = service.db.QueryRowContext(ctx, `SELECT u.id::text,u.email,u.created_at FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()`, digest[:]).Scan(&current.ID, &current.Email, &current.CreatedAt)
	return current, err
}
