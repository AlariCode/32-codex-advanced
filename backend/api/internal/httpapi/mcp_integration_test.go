//go:build integration

package httpapi

import (
	"encoding/json"
	"fmt"
	"linkbook/api/internal/link"
	"linkbook/api/internal/user"
	"linkbook/linkprocessing"
	"net/http"
	"strings"
	"testing"
)

func TestMCPIntegrationSave(t *testing.T) {
	f := newRegistrationFixture(t)
	_, owner := librarySession(t, f)
	token, err := user.NewService(f.db).CreateMCPToken(t.Context(), owner)
	if err != nil {
		t.Fatal(err)
	}
	authenticated := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+token.Token)
		f.handler.ServeHTTP(w, r)
	})
	var firstID string
	for i, raw := range []string{"https://example.com/mcp?utm_source=agent#top", "https://example.com/mcp"} {
		body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"save_link","arguments":{"url":%q}}}`, raw)
		w := mcpRequest(authenticated, body)
		var response struct {
			Result struct {
				StructuredContent mcpSaveOutput `json:"structuredContent"`
				IsError           bool          `json:"isError"`
			} `json:"result"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil || response.Result.IsError {
			t.Fatalf("save: %d %s", w.Code, w.Body.String())
		}
		out := response.Result.StructuredContent
		if out.ID == "" || out.Created != (i == 0) || (i > 0 && out.ID != firstID) {
			t.Fatalf("save result: %s", w.Body.String())
		}
		firstID = out.ID
	}
	var actualOwner, state string
	if err := f.db.QueryRow(`SELECT l.user_id::text,j.state FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1`, firstID).Scan(&actualOwner, &state); err != nil {
		t.Fatal(err)
	}
	if actualOwner != owner || state != "queued" {
		t.Fatalf("wrong owner or job: %s %s", actualOwner, state)
	}
	libraryCounts(t, f, 1, 1)
	for _, raw := range []string{"not-a-url", "", "ftp://example.com", "https://user:pass@example.com"} {
		w := mcpRequest(authenticated, fmt.Sprintf(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_link","arguments":{"url":%q}}}`, raw))
		var response struct {
			Result struct {
				IsError bool `json:"isError"`
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"result"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil || !response.Result.IsError || len(response.Result.Content) != 1 || !strings.Contains(response.Result.Content[0].Text, "http:// or https://") {
			t.Fatalf("invalid URL: %d %s", w.Code, w.Body.String())
		}
	}
	libraryCounts(t, f, 1, 1)
}

func TestMCPIntegrationLibrary(t *testing.T) {
	f := newRegistrationFixture(t)
	_, owner := librarySession(t, f)
	_, other := librarySession(t, f)
	service := link.NewService(f.db)
	h := newMCPHandler(service, owner)
	call := func(name string, args any, wantError bool, out any) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
		w := mcpRequest(h, string(body))
		var result struct {
			Result struct {
				IsError           bool
				StructuredContent json.RawMessage
			}
			Error any
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Error != nil || result.Result.IsError != wantError {
			t.Fatalf("%s: %s", name, w.Body.String())
		}
		if out != nil {
			if err := json.Unmarshal(result.Result.StructuredContent, out); err != nil {
				t.Fatal(err)
			}
		}
		return w.Body.String()
	}
	var first, second mcpSaveOutput
	call("save_link", mcpSaveInput{URL: "https://example.com/one"}, false, &first)
	call("save_link", mcpSaveInput{URL: "https://example.com/two"}, false, &second)
	foreign, _, err := service.Save(t.Context(), other, "https://example.com/private")
	if err != nil {
		t.Fatal(err)
	}
	var page mcpPage
	call("list_links", map[string]any{"limit": 1}, false, &page)
	if len(page.Links) != 1 || page.Links[0].ID != second.ID || page.Links[0].ResourceURI != "linkbook://links/"+second.ID || page.NextCursor == "" {
		t.Fatalf("page: %+v", page)
	}
	call("list_links", map[string]any{"limit": 1, "cursor": page.NextCursor}, false, &page)
	if len(page.Links) != 1 || page.Links[0].ID != first.ID || page.NextCursor != "" {
		t.Fatalf("next page: %+v", page)
	}
	call("list_links", map[string]any{"cursor": "bad"}, true, nil)
	var card mcpCard
	call("get_link", mcpIDInput{ID: first.ID}, false, &card)
	if card.Generation != 1 || card.State != "processing" {
		t.Fatalf("get: %+v", card)
	}
	for _, name := range []string{"get_link", "retry_link", "delete_link"} {
		args := map[string]any{"id": foreign.ID}
		if name == "retry_link" {
			args["generation"] = 1
		}
		call(name, args, true, nil)
	}
	read := func(id string, wantError bool) string {
		t.Helper()
		w := mcpRequest(h, fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"linkbook://links/%s"}}`, id))
		var response struct {
			Error  json.RawMessage
			Result struct {
				Contents []struct {
					Text     string
					MIMEType string
				}
			}
		}
		if json.Unmarshal(w.Body.Bytes(), &response) != nil || (len(response.Error) > 0) != wantError {
			t.Fatalf("resource: %s", w.Body.String())
		}
		if !wantError && (len(response.Result.Contents) != 1 || response.Result.Contents[0].MIMEType != "text/markdown") {
			t.Fatal(w.Body.String())
		}
		return w.Body.String()
	}
	if !strings.Contains(read(first.ID, true), "not ready") {
		t.Fatal("missing not ready guidance")
	}
	read(foreign.ID, true)
	call("retry_link", mcpRetryInput{ID: first.ID, Generation: 2}, true, nil)
	call("retry_link", mcpRetryInput{ID: first.ID, Generation: 1}, true, nil)
	if _, err := f.db.Exec(`UPDATE links SET state='failed',reason='network_error',warnings='["image_not_saved"]' WHERE id=$1`, first.ID); err != nil {
		t.Fatal(err)
	}
	call("get_link", mcpIDInput{ID: first.ID}, false, &card)
	if len(card.Warnings) != 1 || card.Warnings[0] != "image_not_saved" {
		t.Fatalf("warnings: %+v", card)
	}
	call("retry_link", mcpRetryInput{ID: first.ID, Generation: card.Generation}, false, &card)
	if card.Generation != 2 || card.State != "processing" {
		t.Fatalf("retry: %+v", card)
	}
	call("retry_link", mcpRetryInput{ID: first.ID, Generation: 1}, false, &card)
	if card.Generation != 2 {
		t.Fatal("retry was not idempotent")
	}
	// Claim until the target is found; each fixture has its own schema.
	for {
		execution, err := linkprocessing.Claim(t.Context(), f.db)
		if err != nil || execution == nil {
			t.Fatalf("claim: %v", err)
		}
		doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: "Saved article body."}}}
		ok, err := linkprocessing.Publish(t.Context(), f.db, *execution, linkprocessing.Result{Document: &doc, Title: "Article"})
		if err != nil || !ok {
			t.Fatalf("publish: %v %v", ok, err)
		}
		if execution.LinkID == first.ID {
			break
		}
	}
	if !strings.Contains(read(first.ID, false), "Saved article body.") {
		t.Fatal("article text missing")
	}
	var deleted mcpDeleteOutput
	call("delete_link", mcpIDInput{ID: first.ID}, false, &deleted)
	if !deleted.Deleted || deleted.ID != first.ID {
		t.Fatalf("delete: %+v", deleted)
	}
	call("get_link", mcpIDInput{ID: first.ID}, true, nil)
	call("delete_link", mcpIDInput{ID: first.ID}, true, nil)
	read(first.ID, true)
	var count int
	if err := f.db.QueryRow(`SELECT (SELECT count(*) FROM processing_jobs WHERE link_id=$1)+(SELECT count(*) FROM snapshots WHERE link_id=$1)`, first.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("delete cascade: %d %v", count, err)
	}
}
