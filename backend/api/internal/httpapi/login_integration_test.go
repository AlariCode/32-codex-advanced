//go:build integration

package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const loginPath = "/api/users/login"

func loginRequest(handler http.Handler, method, contentType, body, cookie string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "https://linkbook.example"+loginPath, strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func loginUser(t *testing.T, handler http.Handler, email, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"email": email, "password": password})
	if err != nil {
		t.Fatal(err)
	}
	return loginRequest(handler, http.MethodPost, "application/json", string(body), "")
}

func seedLoginUser(t *testing.T, fixture registrationFixture, email, password string) registeredUser {
	t.Helper()
	return assertRegisteredUser(t, fixture, fixture.register(t, email, password), email, password)
}

func snapshotLoginUsers(t *testing.T, fixture registrationFixture) string {
	t.Helper()
	var snapshot string
	if err := fixture.db.QueryRowContext(t.Context(),
		`SELECT COALESCE(json_agg(u ORDER BY u.id)::text, '[]') FROM users u`,
	).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func assertLoginSession(t *testing.T, response *httptest.ResponseRecorder, want registeredUser) string {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
		t.Error("successful login must return application/json")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Error("login response must set Cache-Control: no-store")
	}
	var got registeredUser
	decoder := json.NewDecoder(bytes.NewReader(response.Body.Bytes()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		t.Fatalf("decode public user (no passwords, hashes or tokens): %v", err)
	}
	if got.ID != want.ID || got.Email != want.Email || !got.CreatedAt.Equal(want.CreatedAt) {
		t.Errorf("login user = %+v, want %+v", got, want)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login must issue exactly one session cookie, got %d", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != "linkbook_session" || cookie.Value == "" {
		t.Fatal("login must issue a nonempty linkbook_session cookie")
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "" {
		t.Errorf("session cookie must be HttpOnly, Secure, SameSite=Lax, Path=/ and host-only: %+v", cookie)
	}
	if cookie.MaxAge != 0 || !cookie.Expires.IsZero() {
		t.Error("default login must issue a browser-session cookie")
	}
	if cookie.Value == want.ID || strings.Contains(cookie.Value, want.Email) || strings.Contains(response.Body.String(), cookie.Value) {
		t.Error("session token must be opaque and must not appear in JSON")
	}
	return cookie.Value
}

func assertLoginError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	assertRegistrationError(t, response, status, code)
	var body map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for field := range body {
		if field != "code" && field != "message" {
			t.Errorf("error leaks unexpected field %q", field)
		}
	}
	if len(response.Header().Values("Set-Cookie")) != 0 {
		t.Error("failed login must not issue or replace a session cookie")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Error("login error must set Cache-Control: no-store")
	}
}

func TestLoginIntegrationAcceptsRegisteredCredentials(t *testing.T) {
	tests := []struct{ name, email, password string }{
		{"ordinary", "reader@example.com", "password123"},
		{"eight code points", "reader@example.com", "12345678"},
		{"Cyrillic", "reader@example.com", "абвгдежз"},
		{"emoji", "reader@example.com", strings.Repeat("😀", 8)},
		{"spaces only", "reader@example.com", strings.Repeat(" ", 8)},
		{"password whitespace", "reader@example.com", "  password123  "},
		{"long password", "reader@example.com", strings.Repeat("я", 256)},
		{"plus tag", "reader+tag@mail.example.com", "password123"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			want := seedLoginUser(t, fixture, tt.email, tt.password)
			before := snapshotLoginUsers(t, fixture)
			assertLoginSession(t, loginUser(t, fixture.handler, tt.email, tt.password), want)
			if after := snapshotLoginUsers(t, fixture); after != before {
				t.Error("login changed users or password hashes")
			}
		})
	}
}

func TestLoginIntegrationNormalizesEmail(t *testing.T) {
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	for _, email := range []string{"READER@EXAMPLE.COM", " \t Reader@Example.COM \r\n"} {
		t.Run(email, func(t *testing.T) {
			assertLoginSession(t, loginUser(t, fixture.handler, email, "password123"), want)
		})
	}
}

func TestLoginIntegrationRejectsWrongCredentialsWithoutEnumeration(t *testing.T) {
	fixture := newRegistrationFixture(t)
	seedLoginUser(t, fixture, "reader@example.com", "  Password123  ")
	before := snapshotLoginUsers(t, fixture)
	tests := []struct{ name, email, password string }{
		{"unknown user", "unknown@example.com", "  Password123  "},
		{"wrong password", "reader@example.com", "wrong-password"},
		{"password case", "reader@example.com", "  password123  "},
		{"password trimmed", "reader@example.com", "Password123"},
		{"short wrong password", "reader@example.com", "x"},
		{"plus tag is distinct", "reader+tag@example.com", "  Password123  "},
		{"dots are distinct", "read.er@example.com", "  Password123  "},
		{"SQL injection", "reader@example.com", "' OR 1=1 --"},
	}
	var reference string
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := loginUser(t, fixture.handler, tt.email, tt.password)
			assertLoginError(t, response, http.StatusUnauthorized, "invalid_credentials")
			if reference == "" {
				reference = response.Body.String()
			} else if reference != response.Body.String() {
				t.Error("unknown email and incorrect passwords must have identical response bodies")
			}
		})
	}
	if after := snapshotLoginUsers(t, fixture); after != before {
		t.Error("failed logins changed existing users")
	}
	// A failed attempt must not prevent a later valid login.
	var want registeredUser
	if err := fixture.db.QueryRowContext(t.Context(), "SELECT id::text, email, created_at FROM users").Scan(&want.ID, &want.Email, &want.CreatedAt); err != nil {
		t.Fatal(err)
	}
	assertLoginSession(t, loginUser(t, fixture.handler, "reader@example.com", "  Password123  "), want)
}

func TestLoginIntegrationRejectsInvalidRequests(t *testing.T) {
	valid := `{"email":"reader@example.com","password":"password123"}`
	tests := []struct {
		name, body, contentType, code string
		status                        int
	}{
		{"empty body", "", "application/json", "invalid_request", 400},
		{"broken JSON", `{"email":`, "application/json", "invalid_request", 400},
		{"null body", `null`, "application/json", "invalid_request", 400},
		{"array body", `[]`, "application/json", "invalid_request", 400},
		{"scalar body", `42`, "application/json", "invalid_request", 400},
		{"unknown field", `{"email":"reader@example.com","password":"password123","admin":true}`, "application/json", "invalid_request", 400},
		{"numeric email", `{"email":42,"password":"password123"}`, "application/json", "invalid_request", 400},
		{"numeric password", `{"email":"reader@example.com","password":42}`, "application/json", "invalid_request", 400},
		{"array password", `{"email":"reader@example.com","password":[]}`, "application/json", "invalid_request", 400},
		{"object email", `{"email":{},"password":"password123"}`, "application/json", "invalid_request", 400},
		{"second object", valid + `{}`, "application/json", "invalid_request", 400},
		{"trailing junk", valid + "junk", "application/json", "invalid_request", 400},
		{"empty object", `{}`, "application/json", "invalid_email", 400},
		{"missing email", `{"password":"password123"}`, "application/json", "invalid_email", 400},
		{"null email", `{"email":null,"password":"password123"}`, "application/json", "invalid_email", 400},
		{"empty email", `{"email":"","password":"password123"}`, "application/json", "invalid_email", 400},
		{"whitespace email", `{"email":"  ","password":"password123"}`, "application/json", "invalid_email", 400},
		{"invalid email", `{"email":"not-an-email","password":"password123"}`, "application/json", "invalid_email", 400},
		{"display name", `{"email":"Reader <reader@example.com>","password":"password123"}`, "application/json", "invalid_email", 400},
		{"missing password", `{"email":"reader@example.com"}`, "application/json", "invalid_password", 400},
		{"null password", `{"email":"reader@example.com","password":null}`, "application/json", "invalid_password", 400},
		{"empty password", `{"email":"reader@example.com","password":""}`, "application/json", "invalid_password", 400},
		{"missing content type", valid, "", "unsupported_media_type", 415},
		{"text content type", valid, "text/plain", "unsupported_media_type", 415},
		{"form content type", "email=reader@example.com&password=password123", "application/x-www-form-urlencoded", "unsupported_media_type", 415},
		{"invalid content type", valid, "application/json; charset", "unsupported_media_type", 415},
		{"one byte over limit", valid + strings.Repeat(" ", (1<<20)+1-len(valid)), "application/json", "request_too_large", 413},
	}
	fixture := newRegistrationFixture(t)
	seedLoginUser(t, fixture, "reader@example.com", "password123")
	before := snapshotLoginUsers(t, fixture)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := loginRequest(fixture.handler, http.MethodPost, tt.contentType, tt.body, "")
			assertLoginError(t, response, tt.status, tt.code)
			if after := snapshotLoginUsers(t, fixture); after != before {
				t.Error("invalid login changed existing users")
			}
		})
	}
}

func TestLoginIntegrationAcceptsBodySizeBoundary(t *testing.T) {
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	body := `{"email":"reader@example.com","password":"password123"}`
	body += strings.Repeat(" ", (1<<20)-len(body))
	response := loginRequest(fixture.handler, http.MethodPost, "application/json; charset=utf-8", body, "")
	assertLoginSession(t, response, want)
}

func TestLoginIntegrationRejectsUnsupportedMethods(t *testing.T) {
	fixture := newRegistrationFixture(t)
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			response := loginRequest(fixture.handler, method, "application/json", `{}`, "")
			if response.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want 405", response.Code)
			}
			if response.Header().Get("Allow") != "POST" {
				t.Error("unsupported method must advertise Allow: POST")
			}
			if len(response.Header().Values("Set-Cookie")) != 0 {
				t.Error("unsupported method issued a session")
			}
		})
	}
}

func TestLoginIntegrationIssuesFreshSessions(t *testing.T) {
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	first := assertLoginSession(t, loginUser(t, fixture.handler, want.Email, "password123"), want)
	body := `{"email":"reader@example.com","password":"password123"}`
	for _, supplied := range []string{"attacker-chosen-token", first} {
		response := loginRequest(fixture.handler, http.MethodPost, "application/json", body, "linkbook_session="+supplied)
		fresh := assertLoginSession(t, response, want)
		if fresh == supplied || fresh == first {
			t.Error("repeated login must create a fresh token and prevent session fixation")
		}
	}
	response := loginRequest(fixture.handler, http.MethodPost, "application/json",
		`{"email":"reader@example.com","password":"wrong"}`, "linkbook_session="+first)
	assertLoginError(t, response, http.StatusUnauthorized, "invalid_credentials")
}

func TestLoginIntegrationConcurrentSessions(t *testing.T) {
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	before := snapshotLoginUsers(t, fixture)
	const count = 4
	responses := make(chan *httptest.ResponseRecorder, count)
	var workers sync.WaitGroup
	for range count {
		workers.Go(func() {
			responses <- loginRequest(fixture.handler, http.MethodPost, "application/json",
				`{"email":"reader@example.com","password":"password123"}`, "")
		})
	}
	workers.Wait()
	close(responses)
	tokens := map[string]bool{}
	for response := range responses {
		token := assertLoginSession(t, response, want)
		if tokens[token] {
			t.Error("concurrent logins issued the same session token")
		}
		tokens[token] = true
	}
	if after := snapshotLoginUsers(t, fixture); after != before {
		t.Error("concurrent login changed users")
	}
}

func TestLoginIntegrationDatabaseFailure(t *testing.T) {
	fixture := newRegistrationFixture(t)
	seedLoginUser(t, fixture, "reader@example.com", "password123")
	if err := fixture.db.Close(); err != nil {
		t.Fatal(err)
	}
	response := loginUser(t, fixture.handler, "reader@example.com", "password123")
	assertLoginError(t, response, http.StatusInternalServerError, "internal_error")
	for _, secret := range []string{"password123", "reader@example.com", "sql:", "postgres", "password_hash"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Errorf("database failure exposed %q", secret)
		}
	}
}

func TestLoginIntegrationCorruptPasswordHash(t *testing.T) {
	for _, hash := range []string{"", "not-a-hash", "$argon2id$v=19$m=0,t=0,p=0$invalid$invalid", "$argon2id$v=19$m=4294967295,t=2,p=1$invalid$invalid"} {
		t.Run(hash, func(t *testing.T) {
			fixture := newRegistrationFixture(t)
			want := seedLoginUser(t, fixture, "reader@example.com", "password123")
			if _, err := fixture.db.ExecContext(t.Context(), "UPDATE users SET password_hash = $1 WHERE id = $2", hash, want.ID); err != nil {
				t.Fatal(err)
			}
			before := snapshotLoginUsers(t, fixture)
			response := loginUser(t, fixture.handler, want.Email, "password123")
			assertLoginError(t, response, http.StatusInternalServerError, "internal_error")
			if after := snapshotLoginUsers(t, fixture); after != before {
				t.Error("login must not overwrite corrupt password hashes")
			}
		})
	}
}

func TestLoginIntegrationPersistsOnlySessionDigest(t *testing.T) {
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	token := assertLoginSession(t, loginUser(t, fixture.handler, want.Email, "password123"), want)
	digest := sha256.Sum256([]byte(token))
	var storedID string
	var lifetimeSeconds float64
	if err := fixture.db.QueryRowContext(t.Context(), `
		SELECT user_id::text, EXTRACT(EPOCH FROM expires_at - created_at)
		FROM user_sessions WHERE token_hash = $1
	`, digest[:]).Scan(&storedID, &lifetimeSeconds); err != nil {
		t.Fatalf("find session by token digest: %v", err)
	}
	if storedID != want.ID || lifetimeSeconds != 24*60*60 {
		t.Errorf("session user = %q, lifetime = %v seconds; want %q and 86400", storedID, lifetimeSeconds, want.ID)
	}
	assertLoginError(t, loginUser(t, fixture.handler, want.Email, "wrong"), 401, "invalid_credentials")
	var count int
	if err := fixture.db.QueryRowContext(t.Context(), "SELECT count(*) FROM user_sessions").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 { // Registration and login each create a session.
		t.Errorf("failed login changed sessions: count = %d, want 2", count)
	}
}

func TestLoginIntegrationSessionStorageFailure(t *testing.T) {
	fixture := newRegistrationFixture(t)
	seedLoginUser(t, fixture, "reader@example.com", "password123")
	if _, err := fixture.db.ExecContext(t.Context(), "DROP TABLE user_sessions"); err != nil {
		t.Fatal(err)
	}
	before := snapshotLoginUsers(t, fixture)
	response := loginUser(t, fixture.handler, "reader@example.com", "password123")
	assertLoginError(t, response, 500, "internal_error")
	if strings.Contains(response.Body.String(), "user_sessions") {
		t.Error("session storage failure exposed database details")
	}
	if after := snapshotLoginUsers(t, fixture); after != before {
		t.Error("session storage failure changed users")
	}
}
