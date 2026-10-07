package user

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

// Unknown users still perform a password derivation with the registration cost.
// The digest is deliberately not a real user's password hash.
const dummyPasswordHash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

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
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return User{}, "", fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256([]byte(token))
	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO user_sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')
	`, digest[:], authenticated.ID); err != nil {
		return User{}, "", fmt.Errorf("create login session: %w", err)
	}
	authenticated.PasswordHash = ""
	return authenticated, token, nil
}

func verifyPassword(encoded, password string) (bool, error) {
	invalidHash := errors.New("invalid stored password hash")
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, invalidHash
	}
	var memory, iterations uint32
	var parallelism uint8
	n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)
	if err != nil || n != 3 || parts[3] != fmt.Sprintf("m=%d,t=%d,p=%d", memory, iterations, parallelism) {
		return false, invalidHash
	}
	// Validate before derivation to prevent panics and unbounded allocation/work
	// when persisted hashes are corrupt. These bounds include registration hashes.
	if parallelism == 0 || parallelism > 4 || memory < 8*uint32(parallelism) || memory > 64*1024 || iterations == 0 || iterations > 10 {
		return false, invalidHash
	}
	if len(parts[4]) > 86 || len(parts[5]) != 43 {
		return false, invalidHash
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return false, invalidHash
	}
	want, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(want) != 32 {
		return false, invalidHash
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
