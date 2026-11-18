//go:build integration

package httpapi

import (
	"net/http"
	"testing"
)

func TestLogoutIntegrationRevokesOnlyCurrentSession(t *testing.T) {
	t.Setenv("PUBLIC_ORIGIN", "http://localhost:3000")
	fixture := newRegistrationFixture(t)
	want := seedLoginUser(t, fixture, "reader@example.com", "password123")
	login := func() string {
		return assertLoginSession(t, loginUser(t, fixture.handler, want.Email, "password123"), want)
	}
	current, other := login(), login()

	const path = "/api/users/logout"
	const origin = "http://127.0.0.1:3000"
	checkSession := func(token string, status int) {
		t.Helper()
		response := libraryRequest(fixture, http.MethodGet, "/api/users/me", token, "", "")
		if response.Code != status {
			t.Errorf("GET /api/users/me status = %d, want %d", response.Code, status)
		}
	}

	for _, invalidOrigin := range []string{"", "https://other.example", "http://127.0.0.1:3001", "https://127.0.0.1:3000", "http://localhost.example:3000"} {
		response := libraryRequest(fixture, http.MethodPost, path, current, "", invalidOrigin)
		if response.Code != http.StatusForbidden || response.Header().Get("Set-Cookie") != "" {
			t.Fatalf("unexpected response for invalid origin: status = %d", response.Code)
		}
	}
	checkSession(current, http.StatusOK)

	for _, token := range []string{current, current, "", "invalid"} {
		response := libraryRequest(fixture, http.MethodPost, path, token, "", origin)
		if response.Code != http.StatusNoContent || response.Header().Get("Cache-Control") != "no-store" || response.Body.Len() != 0 {
			t.Fatalf("logout response: status = %d, body = %q", response.Code, response.Body.String())
		}
		cookies := response.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("logout issued %d cookies, want 1", len(cookies))
		}
		cookie := cookies[0]
		if cookie.Name != "linkbook_session" || cookie.Value != "" || cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
			t.Errorf("logout did not clear the session cookie: %+v", cookie)
		}
	}
	checkSession(current, http.StatusUnauthorized)
	checkSession(other, http.StatusOK)
}
