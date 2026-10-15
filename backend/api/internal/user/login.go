package user

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"unicode/utf8"
)

// Login verifies registered credentials and persists a fresh session. Only the
// SHA-256 digest of the random bearer token is stored in the database.
func (service *Service) Login(ctx context.Context, email, password string) (User, string, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return User{}, "", err
	}
	if password == "" || !utf8.ValidString(password) {
		return User{}, "", ErrInvalidPassword
	}
	var authenticated User
	err = service.db.QueryRowContext(ctx, `
		SELECT id::text, email, password_hash, created_at FROM users WHERE email = $1
	`, email).Scan(&authenticated.ID, &authenticated.Email, &authenticated.PasswordHash, &authenticated.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = verifyPassword(dummyPasswordHash, password)
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", fmt.Errorf("find login user: %w", err)
	}
	matches, err := verifyPassword(authenticated.PasswordHash, password)
	if err != nil {
		return User{}, "", err
	}
	if !matches {
		return User{}, "", ErrInvalidCredentials
	}
	token, err := createSession(ctx, service.db, authenticated.ID)
	if err != nil {
		return User{}, "", err
	}
	authenticated.PasswordHash = ""
	return authenticated, token, nil
}

type sessionWriter interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func createSession(ctx context.Context, writer sessionWriter, userID string) (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256([]byte(token))
	if _, err := writer.ExecContext(ctx, `
		INSERT INTO user_sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')
	`, digest[:], userID); err != nil {
		return "", fmt.Errorf("create login session: %w", err)
	}

	return token, nil
}
