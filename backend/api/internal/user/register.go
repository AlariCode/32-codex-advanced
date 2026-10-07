package user

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
)

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
