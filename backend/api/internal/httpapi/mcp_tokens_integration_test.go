//go:build integration

package httpapi

import (
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"linkbook/api/internal/user"
)

func TestMCPTokensIntegration(t *testing.T) {
	f := newRegistrationFixture(t)
	session, owner := librarySession(t, f)
	other, _ := librarySession(t, f)
	path := "/api/users/me/mcp-tokens"
	for _, method := range []string{"GET", "POST", "DELETE"} {
		target := path
		if method == "DELETE" {
			target += "/00000000-0000-0000-0000-000000000000"
		}
		if w := libraryRequest(f, method, target, "", "", "http://localhost:3000"); w.Code != 401 {
			t.Fatalf("anonymous %s: %d", method, w.Code)
		}
	}
	for _, origin := range []string{"", "https://evil.example"} {
		if w := libraryRequest(f, "POST", path, session, "", origin); w.Code != 403 {
			t.Fatalf("origin: %d", w.Code)
		}
	}
	create := func() user.CreatedMCPToken {
		t.Helper()
		return decodeLibrary[user.CreatedMCPToken](t, libraryRequest(f, "POST", path, session, "", "http://localhost:3000"), 201)
	}
	first, second := create(), create()
	if first.Token == second.Token || !strings.HasPrefix(first.Token, "lb_mcp_") {
		t.Fatal("invalid secrets")
	}
	var hash []byte
	var storedOwner string
	if err := f.db.QueryRow(`SELECT token_hash,user_id::text FROM mcp_tokens WHERE id=$1`, first.ID).Scan(&hash, &storedOwner); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(first.Token))
	if string(hash) != string(digest[:]) || storedOwner != owner {
		t.Fatal("token not stored as owner-scoped digest")
	}
	w := libraryRequest(f, "GET", path, session, "", "")
	list := decodeLibrary[[]user.MCPToken](t, w, 200)
	if len(list) != 2 || strings.Contains(w.Body.String(), first.Token) || strings.Contains(w.Body.String(), "token_hash") {
		t.Fatal("list leaks secrets or missing tokens")
	}
	if list := decodeLibrary[[]user.MCPToken](t, libraryRequest(f, "GET", path, other, "", ""), 200); len(list) != 0 {
		t.Fatal("foreign token list")
	}
	call := func(header string, method string, params string) *httptest.ResponseRecorder {
		t.Helper()
		h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if header != "" {
				r.Header.Set("Authorization", header)
			}
			r.AddCookie(&http.Cookie{Name: "linkbook_session", Value: session})
			f.handler.ServeHTTP(w, r)
		})
		return mcpRequest(h, `{"jsonrpc":"2.0","id":1,"method":"`+method+`"`+params+`}`)
	}
	for _, header := range []string{"", "Basic " + first.Token, "Bearer bad", "Bearer " + session, "Bearer " + first.Token + " extra", "Bearer lb_mcp_" + strings.Repeat("!", 43)} {
		w := call(header, "tools/list", "")
		if w.Code != 401 || w.Header().Get("WWW-Authenticate") == "" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid authorization accepted: %d", w.Code)
		}
	}
	if w := call("Bearer "+first.Token, "tools/call", `,"params":{"name":"save_link","arguments":{"url":"https://example.com/token-owner"}}`); w.Code != 200 || strings.Contains(w.Body.String(), `"isError":true`) {
		t.Fatalf("save: %s", w.Body.String())
	}
	var actualOwner string
	if err := f.db.QueryRow(`SELECT user_id::text FROM links WHERE submitted_url='https://example.com/token-owner'`).Scan(&actualOwner); err != nil || actualOwner != owner {
		t.Fatalf("wrong owner: %v", err)
	}
	// A foreign revoke must leave the original token working.
	if w := libraryRequest(f, "DELETE", path+"/"+first.ID, other, "", "http://localhost:3000"); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w := call("Bearer "+first.Token, "tools/list", ""); w.Code != 200 {
		t.Fatal("foreign revoke changed token")
	}
	if w := libraryRequest(f, "DELETE", path+"/"+first.ID, session, "", "https://evil.example"); w.Code != 403 {
		t.Fatal("revoke without origin protection")
	}
	for range 2 {
		if w := libraryRequest(f, "DELETE", path+"/"+first.ID, session, "", "http://localhost:3000"); w.Code != 204 {
			t.Fatal(w.Code)
		}
	}
	if w := call("Bearer "+first.Token, "tools/list", ""); w.Code != 401 {
		t.Fatal("revoked token accepted")
	}
	if w := call("bearer "+second.Token, "tools/list", ""); w.Code != 200 {
		t.Fatal("independent token broken")
	}
	// Bearer auth cannot manage tokens without a website session.
	r := httptest.NewRequest("GET", path, nil)
	r.Header.Set("Authorization", "Bearer "+second.Token)
	out := httptest.NewRecorder()
	f.handler.ServeHTTP(out, r)
	if out.Code != 401 {
		t.Fatal("MCP bearer accepted as website session")
	}
	// A second owner's bearer must never read the first owner's saved link.
	var foreignID string
	if err := f.db.QueryRow(`SELECT id::text FROM users WHERE id<>$1 LIMIT 1`, owner).Scan(&foreignID); err != nil {
		t.Fatal(err)
	}
	foreign, err := user.NewService(f.db).CreateMCPToken(t.Context(), foreignID)
	if err != nil {
		t.Fatal(err)
	}
	out = call("Bearer "+foreign.Token, "tools/call", `,"params":{"name":"list_links","arguments":{}}`)
	var response struct {
		Result struct{ StructuredContent mcpPage }
	}
	if out.Code != 200 || json.Unmarshal(out.Body.Bytes(), &response) != nil || len(response.Result.StructuredContent.Links) != 0 {
		t.Fatal("foreign library leaked")
	}
}
