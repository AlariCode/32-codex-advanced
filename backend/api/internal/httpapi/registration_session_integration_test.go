//go:build integration

package httpapi

import (
	"crypto/sha256"
	"testing"
)

func TestRegistrationIntegrationCreatesSessionAtomically(t *testing.T) {
	f := newRegistrationFixture(t)
	response := f.register(t, "automatic@example.com", "password123")
	registered := assertRegisteredUser(t, f, response, "automatic@example.com", "password123")
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("registration must be no-store")
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected session cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != "linkbook_session" || !c.HttpOnly || !c.Secure || c.Path != "/" || c.Domain != "" {
		t.Fatal("unsafe session cookie")
	}
	digest := sha256.Sum256([]byte(c.Value))
	var owner string
	if err := f.db.QueryRowContext(t.Context(), `SELECT user_id::text FROM user_sessions WHERE token_hash=$1 AND expires_at>now()`, digest[:]).Scan(&owner); err != nil || owner != registered.ID {
		t.Fatalf("session owner: %s %v", owner, err)
	}
	me := libraryRequest(f, "GET", "/api/users/me", c.Value, "", "")
	if me.Code != 200 {
		t.Fatalf("new session cannot access library: %s", me.Body.String())
	}
	duplicate := f.register(t, "automatic@example.com", "password123")
	if duplicate.Code != 409 || len(duplicate.Result().Cookies()) != 0 {
		t.Fatal("duplicate created session")
	}
}
func TestRegistrationIntegrationRollsBackWhenSessionCannotBeCreated(t *testing.T) {
	f := newRegistrationFixture(t)
	if _, err := f.db.ExecContext(t.Context(), `CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'session unavailable'; END $$; CREATE TRIGGER reject_session BEFORE INSERT ON user_sessions FOR EACH ROW EXECUTE FUNCTION reject_session()`); err != nil {
		t.Fatal(err)
	}
	response := f.register(t, "atomic@example.com", "password123")
	if response.Code != 500 || len(response.Result().Cookies()) != 0 {
		t.Fatalf("failed registration: %d", response.Code)
	}
	assertUserCount(t, f.db, 0)
}
