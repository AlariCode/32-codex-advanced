//go:build integration

package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type libraryCard struct {
	ID           string    `json:"id"`
	SubmittedURL string    `json:"submitted_url"`
	State        string    `json:"state"`
	Generation   int       `json:"generation"`
	CreatedAt    time.Time `json:"created_at"`
	RequestedAt  time.Time `json:"requested_at"`
	DeadlineAt   time.Time `json:"deadline_at"`
}
type libraryResult struct {
	Link    libraryCard `json:"link"`
	Created bool        `json:"created"`
}
type libraryList struct {
	Links      []libraryCard `json:"links"`
	NextCursor string        `json:"next_cursor"`
	ServerTime time.Time     `json:"server_time"`
}

func librarySession(t *testing.T, f registrationFixture) (string, string) {
	t.Helper()
	var id string
	if err := f.db.QueryRowContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),$1,'unused') RETURNING id::text`, strings.ToLower(rand.Text())+"@example.com").Scan(&id); err != nil {
		t.Fatal(err)
	}
	token := base64.RawURLEncoding.EncodeToString([]byte(rand.Text() + rand.Text()))
	// Match the 32-byte opaque-token contract of login.
	secret := sha256.Sum256([]byte(token))
	token = base64.RawURLEncoding.EncodeToString(secret[:])
	digest := sha256.Sum256([]byte(token))
	if _, err := f.db.ExecContext(t.Context(), `INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')`, digest[:], id); err != nil {
		t.Fatal(err)
	}
	return token, id
}
func libraryRequest(f registrationFixture, method, path, token, body, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost:3000"+path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.AddCookie(&http.Cookie{Name: "linkbook_session", Value: token})
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func libraryPost(f registrationFixture, token, raw string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"url": raw})
	return libraryRequest(f, "POST", "/api/links", token, string(body), "http://localhost:3000")
}
func decodeLibrary[T any](t *testing.T, w *httptest.ResponseRecorder, status int) T {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status=%d want=%d body=%s", w.Code, status, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("private response must be no-store")
	}
	var result T
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func libraryCounts(t *testing.T, f registrationFixture, links, jobs int) {
	t.Helper()
	for table, want := range map[string]int{"links": links, "processing_jobs": jobs} {
		var got int
		if err := f.db.QueryRowContext(t.Context(), "SELECT count(*) FROM "+table).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s count=%d want=%d", table, got, want)
		}
	}
}
func TestLibraryIntegrationSaveReloadAndDeduplicate(t *testing.T) {
	f := newRegistrationFixture(t)
	token, owner := librarySession(t, f)
	me := decodeLibrary[registeredUser](t, libraryRequest(f, "GET", "/api/users/me", token, "", ""), 200)
	if me.ID != owner || me.Email == "" {
		t.Fatal("session identity missing")
	}
	empty := decodeLibrary[libraryList](t, libraryRequest(f, "GET", "/api/links", token, "", ""), 200)
	if empty.Links == nil || len(empty.Links) != 0 || empty.ServerTime.IsZero() {
		t.Fatal("expected empty JSON array and server time")
	}
	raw := " http://Example.com/article?b=2&utm_source=mail&a=1#section "
	before := time.Now()
	first := decodeLibrary[libraryResult](t, libraryPost(f, token, raw), 201)
	if !first.Created || first.Link.State != "processing" || first.Link.Generation != 1 || first.Link.SubmittedURL != strings.TrimSpace(raw) {
		t.Fatalf("bad initial card: %+v", first)
	}
	if first.Link.RequestedAt.Before(before.Add(-time.Second)) || first.Link.DeadlineAt.Sub(first.Link.RequestedAt) != 120*time.Second {
		t.Fatal("deadline must start at saving and last 120 seconds")
	}
	var submitted, fetch, key, state string
	var generation int
	var deadline time.Time
	var execution *string
	var lease *time.Time
	if err := f.db.QueryRowContext(t.Context(), `SELECT l.submitted_url,l.fetch_url,l.dedup_key,j.state,j.generation,j.deadline_at,j.execution_token::text,j.lease_expires_at FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1 AND l.user_id=$2`, first.Link.ID, owner).Scan(&submitted, &fetch, &key, &state, &generation, &deadline, &execution, &lease); err != nil {
		t.Fatal(err)
	}
	if fetch != "http://Example.com/article?b=2&utm_source=mail&a=1" || key != "https://example.com/article?b=2&a=1" || state != "queued" || generation != 1 || !deadline.Equal(first.Link.DeadlineAt) || execution != nil || lease != nil {
		t.Fatalf("wrong durable job / URL separation: %q %q %s", fetch, key, state)
	}
	duplicate := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/article?b=2&a=1#other"), 200)
	if duplicate.Created || duplicate.Link.ID != first.Link.ID || !duplicate.Link.CreatedAt.Equal(first.Link.CreatedAt) {
		t.Fatal("duplicate changed identity or creation time")
	}
	// A fresh handler models reload; no worker runs in this fixture.
	f.handler = NewHandler(f.db)
	saved := decodeLibrary[libraryCard](t, libraryRequest(f, "GET", "/api/links/"+first.Link.ID, token, "", ""), 200)
	if saved.ID != first.Link.ID || saved.State != "processing" {
		t.Fatal("saved card did not survive reload")
	}
	other, _ := librarySession(t, f)
	independent := decodeLibrary[libraryResult](t, libraryPost(f, other, "https://example.com/article?b=2&a=1"), 201)
	if independent.Link.ID == first.Link.ID {
		t.Fatal("owners share a card")
	}
	libraryCounts(t, f, 2, 2)
}
func TestLibraryIntegrationConcurrentDuplicate(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	responses := make([]*httptest.ResponseRecorder, 12)
	start := make(chan struct{})
	var group sync.WaitGroup
	for i := range responses {
		group.Go(func() {
			<-start
			raw := "http://EXAMPLE.com/a?utm_campaign=x#top"
			if i%2 == 0 {
				raw = "https://example.com/a"
			}
			responses[i] = libraryPost(f, token, raw)
		})
	}
	close(start)
	group.Wait()
	created := 0
	id := ""
	for _, w := range responses {
		if w.Code == 201 {
			created++
		} else if w.Code != 200 {
			t.Fatalf("concurrent POST: %d %s", w.Code, w.Body.String())
		}
		result := decodeLibrary[libraryResult](t, w, w.Code)
		if id != "" && id != result.Link.ID {
			t.Fatal("duplicate IDs")
		}
		id = result.Link.ID
	}
	if created != 1 {
		t.Fatalf("created=%d want 1", created)
	}
	libraryCounts(t, f, 1, 1)
}
func TestLibraryIntegrationLongKeysAndDigestCollision(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	a := "https://example.com/" + strings.Repeat("a", 12000)
	first := decodeLibrary[libraryResult](t, libraryPost(f, token, a), 201)
	b := "https://example.com/" + strings.Repeat("b", 12000)
	digest := sha256.Sum256([]byte(b))
	// Simulate a digest collision without weakening the production hash.
	if _, err := f.db.ExecContext(t.Context(), "UPDATE links SET dedup_digest=$1 WHERE id=$2", digest[:], first.Link.ID); err != nil {
		t.Fatal(err)
	}
	second := decodeLibrary[libraryResult](t, libraryPost(f, token, b), 201)
	if second.Link.ID == first.Link.ID {
		t.Fatal("digest match returned a different full key")
	}
	again := decodeLibrary[libraryResult](t, libraryPost(f, token, b), 200)
	if again.Link.ID != second.Link.ID {
		t.Fatal("collision bucket lost deduplication")
	}
	libraryCounts(t, f, 2, 2)
}
func TestLibraryIntegrationEnqueueRollbackAndCommitBudget(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	if _, err := f.db.ExecContext(t.Context(), `CREATE FUNCTION reject_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'enqueue unavailable'; END $$; CREATE TRIGGER reject_job BEFORE INSERT ON processing_jobs FOR EACH ROW EXECUTE FUNCTION reject_job()`); err != nil {
		t.Fatal(err)
	}
	assertRegistrationError(t, libraryPost(f, token, "https://example.com/a"), 500, "internal_error")
	libraryCounts(t, f, 0, 0)
	if _, err := f.db.ExecContext(t.Context(), `DROP TRIGGER reject_job ON processing_jobs; CREATE FUNCTION delay_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER delay_job BEFORE INSERT ON processing_jobs FOR EACH ROW EXECUTE FUNCTION delay_job()`); err != nil {
		t.Fatal(err)
	}
	saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/a"), 201)
	if time.Since(saved.Link.RequestedAt) > 500*time.Millisecond {
		t.Fatal("time spent enqueueing consumed the durable budget before commit")
	}
	libraryCounts(t, f, 1, 1)
}
func TestLibraryIntegrationPagination(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	other, _ := librarySession(t, f)
	for i := range 5 {
		decodeLibrary[libraryResult](t, libraryPost(f, token, fmt.Sprintf("https://example.com/%d", i)), 201)
	}
	decodeLibrary[libraryResult](t, libraryPost(f, other, "https://example.com/private"), 201)
	// Force timestamp ties, so the UUID tie breaker is necessary.
	if _, err := f.db.ExecContext(t.Context(), "UPDATE links SET created_at='2026-01-01T00:00:00Z'"); err != nil {
		t.Fatal(err)
	}
	first := decodeLibrary[libraryList](t, libraryRequest(f, "GET", "/api/links?limit=2", token, "", ""), 200)
	if len(first.Links) != 2 || first.NextCursor == "" || first.Links[0].ID <= first.Links[1].ID {
		t.Fatal("wrong initial keyset ordering")
	}
	newest := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/new"), 201)
	seen := map[string]bool{}
	page := first
	for {
		for _, card := range page.Links {
			if seen[card.ID] || card.ID == newest.Link.ID || strings.Contains(card.SubmittedURL, "private") {
				t.Fatal("unstable or unscoped pagination")
			}
			seen[card.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		page = decodeLibrary[libraryList](t, libraryRequest(f, "GET", "/api/links?limit=2&cursor="+page.NextCursor, token, "", ""), 200)
	}
	if len(seen) != 5 {
		t.Fatalf("paginated %d cards want 5", len(seen))
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=no", "cursor=broken"} {
		assertRegistrationError(t, libraryRequest(f, "GET", "/api/links?"+query, token, "", ""), 400, "invalid_request")
	}
}
func TestLibraryIntegrationAccessAndValidation(t *testing.T) {
	f := newRegistrationFixture(t)
	token, _ := librarySession(t, f)
	other, _ := librarySession(t, f)
	saved := decodeLibrary[libraryResult](t, libraryPost(f, token, "https://example.com/secret"), 201)
	missing := "12345678-1234-4234-8234-123456789abc"
	foreign := libraryRequest(f, "GET", "/api/links/"+saved.Link.ID, other, "", "")
	absent := libraryRequest(f, "GET", "/api/links/"+missing, other, "", "")
	assertRegistrationError(t, foreign, 404, "not_found")
	assertRegistrationError(t, absent, 404, "not_found")
	if foreign.Body.String() != absent.Body.String() {
		t.Fatal("foreign ID leaks existence")
	}
	for _, bad := range []string{"", "not-a-token", base64.RawURLEncoding.EncodeToString(make([]byte, 32))} {
		for _, path := range []string{"/api/users/me", "/api/links", "/api/links/" + saved.Link.ID} {
			decodeLibrary[errorResponse](t, libraryRequest(f, "GET", path, bad, "", ""), 401)
		}
		decodeLibrary[errorResponse](t, libraryPost(f, bad, "https://example.com/a"), 401)
	}
	expired, _ := librarySession(t, f)
	hash := sha256.Sum256([]byte(expired))
	if _, err := f.db.ExecContext(t.Context(), "UPDATE user_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1", hash[:]); err != nil {
		t.Fatal(err)
	}
	decodeLibrary[errorResponse](t, libraryRequest(f, "GET", "/api/users/me", expired, "", ""), 401)
	for _, origin := range []string{"https://evil.example", "null", "", "http://localhost:3000.evil.example"} {
		decodeLibrary[errorResponse](t, libraryRequest(f, "POST", "/api/links", token, `{"url":"https://example.com/a"}`, origin), 403)
	}
	spoof := httptest.NewRequest("POST", "http://localhost:8080/api/links", strings.NewReader(`{"url":"https://example.com/a"}`))
	spoof.RemoteAddr = "203.0.113.1:5000"
	spoof.Header.Set("Origin", "https://evil.example")
	spoof.Header.Set("X-Forwarded-Host", "evil.example")
	spoof.Header.Set("X-Forwarded-Proto", "https")
	spoof.AddCookie(&http.Cookie{Name: "linkbook_session", Value: token})
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, spoof)
	decodeLibrary[errorResponse](t, w, 403)
	for _, raw := range []string{"", "example.com", "ftp://example.com/a", "https://reader:secret@example.com/a", "https://example.com/?q=%zz"} {
		assertRegistrationError(t, libraryPost(f, token, raw), 400, "invalid_url")
	}
	assertRegistrationError(t, libraryRequest(f, "POST", "/api/links", token, `{"url":"https://example.com/a","user_id":"`+missing+`"}`, "http://localhost:3000"), 400, "invalid_request")
	assertRegistrationError(t, libraryRequest(f, "GET", "/api/links/not-uuid", token, "", ""), 400, "invalid_request")
	libraryCounts(t, f, 1, 1)
}
