package user

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
)

func sessionDigest(token string) ([32]byte, error) {
	secret, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(secret) != 32 || base64.RawURLEncoding.EncodeToString(secret) != token {
		return [32]byte{}, ErrInvalidCredentials
	}
	return sha256.Sum256([]byte(token)), nil
}

// Current verifies the same opaque cookie issued by Login, returning public data.
func (service *Service) Current(ctx context.Context, token string) (User, error) {
	digest, err := sessionDigest(token)
	if err != nil {
		return User{}, err
	}
	var current User
	err = service.db.QueryRowContext(ctx, `SELECT u.id::text,u.email,u.created_at FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()`, digest[:]).Scan(&current.ID, &current.Email, &current.CreatedAt)
	return current, err
}

// Logout revokes the current browser session and accepts missing or invalid tokens.
func (service *Service) Logout(ctx context.Context, token string) error {
	digest, err := sessionDigest(token)
	if err != nil {
		return nil
	}
	_, err = service.db.ExecContext(ctx, "DELETE FROM user_sessions WHERE token_hash = $1", digest[:])
	return err
}
