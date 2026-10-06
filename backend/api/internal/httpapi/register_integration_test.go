//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"linkbook/api/internal/database"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/argon2"
)

const registrationPath = "/api/users/register"

type registrationFixture struct {
	db      *sql.DB
	handler http.Handler
}

type registeredUser struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

func newRegistrationFixture(t *testing.T) registrationFixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required; start the test database with make test-db-up")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	if config.Database != "linkbook_test" {
		t.Fatal("integration tests require the dedicated linkbook_test database")
	}
	scopedURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse test database URL: %v", err)
	}
	if scopedURL.Scheme != "postgres" && scopedURL.Scheme != "postgresql" {
		t.Fatal("TEST_DATABASE_URL must be a postgres:// or postgresql:// URL")
	}

	admin := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = admin.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := admin.PingContext(ctx); err != nil {
		t.Fatalf("connect to test PostgreSQL: %v", err)
	}

	schema := "registration_" + strings.ToLower(rand.Text())
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create isolated test schema: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("remove test schema: %v", err)
		}
	})

	query := scopedURL.Query()
	query.Set("search_path", schema)
	scopedURL.RawQuery = query.Encode()
	db, err := database.Open(ctx, scopedURL.String())
	if err != nil {
		t.Fatalf("initialize isolated database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return registrationFixture{db: db, handler: NewHandler(db)}
}

func (fixture registrationFixture) request(method, contentType, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, registrationPath, strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, request)
	return response
}

func (fixture registrationFixture) register(t *testing.T, email, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"email": email, "password": password})
	if err != nil {
		t.Fatalf("encode registration: %v", err)
	}
	return fixture.request(http.MethodPost, "application/json", string(body))
}

func assertUserCount(t *testing.T, db *sql.DB, want int) {
	t.Helper()
	var count int
	if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != want {
		t.Errorf("users count = %d, want %d", count, want)
	}
}

func assertRegistrationError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", response.Code, status, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", contentType)
	}
	var result struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if result.Code != code {
		t.Errorf("error code = %q, want %q", result.Code, code)
	}
	if strings.Contains(response.Body.String(), "password_hash") {
		t.Error("error response leaks password_hash")
	}
}

func assertRegisteredUser(
	t *testing.T,
	fixture registrationFixture,
	response *httptest.ResponseRecorder,
	email, password string,
) registeredUser {
	t.Helper()
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", contentType)
	}
	var user registeredUser
	decoder := json.NewDecoder(response.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&user); err != nil {
		t.Fatalf("decode public user fields: %v", err)
	}
	if user.ID == "" || user.CreatedAt.IsZero() {
		t.Fatal("registration must return a nonempty id and created_at")
	}
	if user.Email != email {
		t.Errorf("response email = %q, want %q", user.Email, email)
	}

	var storedEmail, hash string
	var createdAt time.Time
	err := fixture.db.QueryRowContext(t.Context(),
		"SELECT email, password_hash, created_at FROM users WHERE id = $1", user.ID,
	).Scan(&storedEmail, &hash, &createdAt)
	if err != nil {
		t.Fatalf("read registered user: %v", err)
	}
	if storedEmail != email || !createdAt.Equal(user.CreatedAt) {
		t.Errorf("stored user differs from response: email=%q created_at=%s", storedEmail, createdAt)
	}
	if hash == "" || hash == password {
		t.Fatal("database must store a password hash, not the original password")
	}
	if !matchesArgon2Password(t, hash, password) {
		t.Error("stored hash does not verify the original password")
	}
	if matchesArgon2Password(t, hash, password+"wrong") {
		t.Error("stored hash accepts an incorrect password")
	}
	assertUserCount(t, fixture.db, 1)
	return user
}

// The PHC format lets these tests verify the stored hash independently of the application.
func matchesArgon2Password(t *testing.T, encoded, password string) bool {
	t.Helper()
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		t.Fatal("password_hash must use the Argon2id PHC format")
	}
	var memory, iterations uint32
	var parallelism uint8
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || n != 3 {
		t.Fatalf("invalid Argon2id parameters: %q", parts[3])
	}
	if memory < 8 || memory > 256*1024 {
		t.Fatal("Argon2id memory parameter outside test verification bounds")
	}
	if iterations == 0 || iterations > 10 || parallelism == 0 || parallelism > 16 {
		t.Fatal("Argon2id time or parallelism parameter outside test verification bounds")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 {
		t.Fatal("Argon2id salt must contain at least 16 bytes")
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		t.Fatal("invalid Argon2id digest")
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func TestRegisterIntegrationAcceptsValidUsers(t *testing.T) {
	maxEmail := strings.Repeat("a", 64) + "@" + strings.Repeat("b", 63) + "." +
		strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
	tests := []struct {
		name     string
		email    string
		password string
		want     string
	}{
		{name: "ordinary user", email: "reader@example.com", password: "password123", want: "reader@example.com"},
		{name: "normalize email", email: " \t READER@EXAMPLE.COM \r\n", password: "password123", want: "reader@example.com"},
		{
			name: "plus tag and subdomain", email: "reader+tag@mail.example.com",
			password: "password123", want: "reader+tag@mail.example.com",
		},
		{name: "exactly eight characters", email: "reader@example.com", password: "12345678", want: "reader@example.com"},
		{name: "letters only", email: "reader@example.com", password: "abcdefgh", want: "reader@example.com"},
		{name: "Cyrillic", email: "reader@example.com", password: "абвгдежз", want: "reader@example.com"},
		{
			name: "emoji", email: "reader@example.com",
			password: "😀😀😀😀😀😀😀😀", want: "reader@example.com",
		},
		{name: "spaces only", email: "reader@example.com", password: "        ", want: "reader@example.com"},
		{
			name: "preserve password whitespace", email: "reader@example.com",
			password: "  abcdef  ", want: "reader@example.com",
		},
		{name: "long password", email: "reader@example.com", password: strings.Repeat("я", 256), want: "reader@example.com"},
		{name: "maximum email length", email: maxEmail, password: "password123", want: maxEmail},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			response := fixture.register(t, tt.email, tt.password)
			assertRegisteredUser(t, fixture, response, tt.want, tt.password)
		})
	}
}

func TestRegisterIntegrationRejectsInvalidEmail(t *testing.T) {
	tests := []struct {
		name  string
		value any
	}{
		{name: "null", value: nil},
		{name: "empty", value: ""},
		{name: "whitespace", value: " \t\n "},
		{name: "missing at", value: "reader.example.com"},
		{name: "missing local part", value: "@example.com"},
		{name: "missing domain", value: "reader@"},
		{name: "multiple at signs", value: "reader@@example.com"},
		{name: "space in local part", value: "read er@example.com"},
		{name: "space in domain", value: "reader@exa mple.com"},
		{name: "display name", value: "Reader <reader@example.com>"},
		{name: "multiple addresses", value: "reader@example.com,other@example.com"},
		{name: "newline inside address", value: "reader@exam\nple.com"},
		{name: "consecutive local dots", value: "read..er@example.com"},
		{name: "leading local dot", value: ".reader@example.com"},
		{name: "trailing local dot", value: "reader.@example.com"},
		{name: "invalid domain label", value: "reader@-example.com"},
		{name: "empty domain label", value: "reader@example..com"},
		{name: "local part too long", value: strings.Repeat("a", 65) + "@example.com"},
		{name: "domain label too long", value: "reader@" + strings.Repeat("a", 64) + ".com"},
		{name: "address too long", value: strings.Repeat("a", 64) + "@" + strings.Repeat("b", 63) + "." +
			strings.Repeat("c", 63) + "." + strings.Repeat("d", 62)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			body, err := json.Marshal(map[string]any{"email": tt.value, "password": "password123"})
			if err != nil {
				t.Fatal(err)
			}
			response := fixture.request(http.MethodPost, "application/json", string(body))
			assertUserCount(t, fixture.db, 0)
			assertRegistrationError(t, response, http.StatusBadRequest, "invalid_email")
		})
	}
}

func TestRegisterIntegrationRejectsInvalidPassword(t *testing.T) {
	tests := []struct {
		name     string
		password any
	}{
		{name: "null", password: nil},
		{name: "empty", password: ""},
		{name: "one character", password: "a"},
		{name: "seven characters", password: "1234567"},
		{name: "seven Cyrillic characters", password: "абвгдеж"},
		{name: "seven emoji", password: "😀😀😀😀😀😀😀"},
		{name: "seven spaces", password: "       "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			body, err := json.Marshal(map[string]any{"email": "reader@example.com", "password": tt.password})
			if err != nil {
				t.Fatal(err)
			}
			response := fixture.request(http.MethodPost, "application/json", string(body))
			assertUserCount(t, fixture.db, 0)
			assertRegistrationError(t, response, http.StatusBadRequest, "invalid_password")
		})
	}
}

func TestRegisterIntegrationRejectsMalformedRequests(t *testing.T) {
	validBody := `{"email":"reader@example.com","password":"password123"}`
	tests := []struct {
		name        string
		body        string
		contentType string
		status      int
		code        string
	}{
		{name: "empty body", body: "", status: 400, code: "invalid_request"},
		{name: "broken JSON", body: `{"email":`, status: 400, code: "invalid_request"},
		{name: "array", body: `[]`, status: 400, code: "invalid_request"},
		{name: "null", body: `null`, status: 400, code: "invalid_request"},
		{name: "scalar", body: `"text"`, status: 400, code: "invalid_request"},
		{name: "empty object", body: `{}`, status: 400, code: "invalid_email"},
		{name: "missing email", body: `{"password":"password123"}`, status: 400, code: "invalid_email"},
		{name: "missing password", body: `{"email":"reader@example.com"}`, status: 400, code: "invalid_password"},
		{name: "numeric email", body: `{"email":42,"password":"password123"}`, status: 400, code: "invalid_request"},
		{name: "array email", body: `{"email":[],"password":"password123"}`, status: 400, code: "invalid_request"},
		{
			name: "numeric password", body: `{"email":"reader@example.com","password":42}`,
			status: 400, code: "invalid_request",
		},
		{name: "object password", body: `{"email":"reader@example.com","password":{}}`, status: 400, code: "invalid_request"},
		{
			name: "unknown field", body: `{"email":"reader@example.com","password":"password123","admin":true}`,
			status: 400, code: "invalid_request",
		},
		{name: "multiple objects", body: validBody + `{}`, status: 400, code: "invalid_request"},
		{name: "trailing junk", body: validBody + "junk", status: 400, code: "invalid_request"},
		{name: "text content type", body: validBody, contentType: "text/plain", status: 415, code: "unsupported_media_type"},
		{name: "too large", body: strings.Repeat(" ", 1024*1024+1), status: 413, code: "request_too_large"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			contentType := tt.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			response := fixture.request(http.MethodPost, contentType, tt.body)
			assertUserCount(t, fixture.db, 0)
			assertRegistrationError(t, response, tt.status, tt.code)
		})
	}
	t.Run("missing content type", func(t *testing.T) {
		fixture := newRegistrationFixture(t)
		response := fixture.request(http.MethodPost, "", validBody)
		assertUserCount(t, fixture.db, 0)
		assertRegistrationError(t, response, http.StatusUnsupportedMediaType, "unsupported_media_type")
	})
}

func TestRegisterIntegrationRejectsDuplicateEmail(t *testing.T) {
	for _, email := range []string{"reader@example.com", "READER@EXAMPLE.COM", " reader@example.com "} {
		t.Run(email, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			first := fixture.register(t, "reader@example.com", "password123")
			user := assertRegisteredUser(t, fixture, first, "reader@example.com", "password123")
			var originalHash string
			if err := fixture.db.QueryRowContext(t.Context(),
				"SELECT password_hash FROM users WHERE id = $1", user.ID,
			).Scan(&originalHash); err != nil {
				t.Fatal(err)
			}
			second := fixture.register(t, email, "different password")
			assertUserCount(t, fixture.db, 1)
			var currentHash string
			if err := fixture.db.QueryRowContext(t.Context(),
				"SELECT password_hash FROM users WHERE id = $1", user.ID,
			).Scan(&currentHash); err != nil {
				t.Fatal(err)
			}
			if currentHash != originalHash {
				t.Error("duplicate registration changed the existing password hash")
			}
			assertRegistrationError(t, second, http.StatusConflict, "email_exists")
		})
	}
}

func TestRegisterIntegrationConcurrentDuplicate(t *testing.T) {
	fixture := newRegistrationFixture(t)
	responses := make([]*httptest.ResponseRecorder, 2)
	var group sync.WaitGroup
	start := make(chan struct{})
	for i := range responses {
		group.Go(func() {
			<-start
			responses[i] = fixture.request(http.MethodPost, "application/json",
				`{"email":"reader@example.com","password":"password123"}`)
		})
	}
	close(start)
	group.Wait()
	assertUserCount(t, fixture.db, 1)
	var successes, conflicts int
	for _, response := range responses {
		switch response.Code {
		case http.StatusCreated:
			successes++
			assertRegisteredUser(t, fixture, response, "reader@example.com", "password123")
		case http.StatusConflict:
			conflicts++
			assertRegistrationError(t, response, http.StatusConflict, "email_exists")
		default:
			t.Errorf("concurrent registration status = %d; body: %s", response.Code, response.Body.String())
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Errorf("concurrent results: %d successful, %d conflicts; want one of each", successes, conflicts)
	}
}

func TestRegisterIntegrationDistinctUsersAndSaltedPasswords(t *testing.T) {
	fixture := newRegistrationFixture(t)
	emails := []string{"reader@example.com", "reader+tag@example.com", "read.er@example.com", "other@example.com"}
	ids := map[string]bool{}
	hashes := map[string]bool{}
	for _, email := range emails {
		response := fixture.register(t, email, "password123")
		if response.Code != http.StatusCreated {
			t.Fatalf("register %q: status = %d; body: %s", email, response.Code, response.Body.String())
		}
		var user registeredUser
		if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
			t.Fatal(err)
		}
		var hash string
		if err := fixture.db.QueryRowContext(t.Context(),
			"SELECT password_hash FROM users WHERE id = $1 AND email = $2", user.ID, email,
		).Scan(&hash); err != nil {
			t.Fatal(err)
		}
		if ids[user.ID] || hashes[hash] {
			t.Error("different users must have distinct IDs and independently salted password hashes")
		}
		ids[user.ID] = true
		hashes[hash] = true
		if !matchesArgon2Password(t, hash, "password123") {
			t.Error("stored password hash does not verify")
		}
	}
	assertUserCount(t, fixture.db, len(emails))
}

func TestRegisterIntegrationInvalidRequestPreservesExistingUser(t *testing.T) {
	fixture := newRegistrationFixture(t)
	response := fixture.register(t, "reader@example.com", "password123")
	user := assertRegisteredUser(t, fixture, response, "reader@example.com", "password123")
	var before []byte
	if err := fixture.db.QueryRowContext(t.Context(),
		"SELECT row_to_json(users)::text FROM users WHERE id = $1", user.ID,
	).Scan(&before); err != nil {
		t.Fatal(err)
	}
	response = fixture.register(t, "other@example.com", "short")
	assertUserCount(t, fixture.db, 1)
	var after []byte
	if err := fixture.db.QueryRowContext(t.Context(),
		"SELECT row_to_json(users)::text FROM users WHERE id = $1", user.ID,
	).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Error("invalid registration changed the existing user")
	}
	assertRegistrationError(t, response, http.StatusBadRequest, "invalid_password")
}

func TestRegisterIntegrationBodySizeBoundary(t *testing.T) {
	body := `{"email":"reader@example.com","password":"password123"}`
	t.Run("exactly one MiB", func(t *testing.T) {
		fixture := newRegistrationFixture(t)
		padded := body + strings.Repeat(" ", 1024*1024-len(body))
		response := fixture.request(http.MethodPost, "application/json; charset=utf-8", padded)
		assertRegisteredUser(t, fixture, response, "reader@example.com", "password123")
	})
	t.Run("one byte over limit", func(t *testing.T) {
		fixture := newRegistrationFixture(t)
		padded := body + strings.Repeat(" ", 1024*1024+1-len(body))
		response := fixture.request(http.MethodPost, "application/json", padded)
		assertUserCount(t, fixture.db, 0)
		assertRegistrationError(t, response, http.StatusRequestEntityTooLarge, "request_too_large")
	})
}

func TestRegisterIntegrationDatabaseFailure(t *testing.T) {
	fixture := newRegistrationFixture(t)
	if err := fixture.db.Close(); err != nil {
		t.Fatal(err)
	}
	response := fixture.register(t, "reader@example.com", "password123")
	assertRegistrationError(t, response, http.StatusInternalServerError, "internal_error")
	if strings.Contains(response.Body.String(), "password123") || strings.Contains(response.Body.String(), "sql:") {
		t.Error("database failure exposed the password or internal database details")
	}
}
