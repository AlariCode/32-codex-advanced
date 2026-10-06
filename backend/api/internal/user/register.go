package user

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/argon2"
)

var (
	ErrInvalidEmail    = errors.New("invalid email")
	ErrInvalidPassword = errors.New("password must contain at least 8 characters")
	ErrEmailExists     = errors.New("email already exists")
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (service *Service) Register(ctx context.Context, email, password string) (User, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 {
		return User{}, ErrInvalidPassword
	}
	hash := hashPassword(password)
	id := newID()
	var registered User
	err = service.db.QueryRowContext(ctx, `
		INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
		RETURNING id::text, email, created_at
	`, id, email, hash).Scan(&registered.ID, &registered.Email, &registered.CreatedAt)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) {
			isDuplicate := postgresError.Code == "23505"
			isEmailConstraint := postgresError.ConstraintName == "users_email_key"
			if isDuplicate && isEmailConstraint {
				return User{}, ErrEmailExists
			}
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return registered, nil
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || len(email) > 254 {
		return "", ErrInvalidEmail
	}
	address, err := mail.ParseAddress(email)
	if err != nil {
		return "", ErrInvalidEmail
	}
	if address.Name != "" || address.Address != email {
		return "", ErrInvalidEmail
	}
	local, domain, found := strings.Cut(email, "@")
	if !found || len(local) > 64 {
		return "", ErrInvalidEmail
	}
	for label := range strings.SplitSeq(domain, ".") {
		if label == "" || len(label) > 63 {
			return "", ErrInvalidEmail
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", ErrInvalidEmail
		}
		for _, character := range label {
			isLetter := character >= 'a' && character <= 'z'
			isDigit := character >= '0' && character <= '9'
			if !isLetter && !isDigit && character != '-' {
				return "", ErrInvalidEmail
			}
		}
	}
	return email, nil
}

func hashPassword(password string) string {
	const memory = 19 * 1024
	const iterations = 2
	const parallelism = 1
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, 32)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		memory,
		iterations,
		parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
}

func newID() string {
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		id[:4],
		id[4:6],
		id[6:8],
		id[8:10],
		id[10:],
	)
}
