package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"linkbook/api/internal/link"
)

func mcpRequest(handler http.Handler, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/mcp", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	r.Header.Set("MCP-Protocol-Version", "2025-11-25")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestMCPListStateless(t *testing.T) {
	h := newMCPHandler(link.NewService(nil), "owner")
	w := mcpRequest(h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	var response struct {
		Result struct {
			Tools []struct {
				Name        string `json:"name"`
				InputSchema struct {
					Required []string `json:"required"`
				} `json:"inputSchema"`
			} `json:"tools"`
		} `json:"result"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatalf("tools/list: %d %s", w.Code, w.Body.String())
	}
	tools := response.Result.Tools
	if len(tools) != 5 {
		t.Fatalf("unexpected tools: %s", w.Body.String())
	}
	for _, tool := range tools {
		if tool.Name == "save_link" && (len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "url") {
			t.Fatalf("save schema: %s", w.Body.String())
		}
	}
	if w.Header().Get("Mcp-Session-Id") != "" || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected headers: %v", w.Header())
	}
	for _, method := range []string{"GET", "DELETE"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, "/mcp", nil))
		if w.Code != 405 {
			t.Fatalf("%s: %d", method, w.Code)
		}
	}
}

func TestMCPRejectsOrigin(t *testing.T) {
	h := newMCPHandler(link.NewService(nil), "owner")
	for _, method := range []string{"POST", "GET", "OPTIONS", "DELETE"} {
		for _, origin := range []string{"", "null", "http://localhost:3000", "https://evil.example"} {
			r := httptest.NewRequest(method, "/mcp", nil)
			r.Header.Set("Origin", origin)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 403 {
				t.Fatalf("%s Origin=%q: %d", method, origin, w.Code)
			}
		}
	}
}

func TestMCPRequiresToken(t *testing.T) {
	w := mcpRequest(NewHandler(nil), `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if w.Code != 401 {
		t.Fatalf("unauthorized endpoint: %d %s", w.Code, w.Body.String())
	}
}

func TestMCPToolContracts(t *testing.T) {
	h := newMCPHandler(link.NewService(nil), "owner")
	w := mcpRequest(h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	var response struct {
		Result struct {
			Tools []struct {
				Name        string
				Description string
				InputSchema struct {
					Properties map[string]struct{ Description string }
				}
				OutputSchema map[string]any
				Annotations  struct {
					ReadOnlyHint    bool
					DestructiveHint *bool
					OpenWorldHint   *bool
				}
			}
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, tool := range response.Result.Tools {
		seen[tool.Name] = true
		if tool.Description == "" || len(tool.OutputSchema) == 0 {
			t.Fatalf("missing contract: %s", tool.Name)
		}
		for field, schema := range tool.InputSchema.Properties {
			if schema.Description == "" {
				t.Fatalf("missing description: %s.%s", tool.Name, field)
			}
		}
		a := tool.Annotations
		if a.ReadOnlyHint != (tool.Name == "list_links" || tool.Name == "get_link") || a.DestructiveHint == nil || *a.DestructiveHint != (tool.Name == "delete_link") || a.OpenWorldHint == nil || *a.OpenWorldHint {
			t.Fatalf("annotations: %s", tool.Name)
		}
	}
	for _, name := range []string{"save_link", "list_links", "get_link", "retry_link", "delete_link"} {
		if !seen[name] {
			t.Fatalf("missing %s", name)
		}
	}
	for _, call := range []string{
		`{"name":"get_link","arguments":{"id":"bad"}}`,
		`{"name":"delete_link","arguments":{"id":"bad"}}`,
		`{"name":"retry_link","arguments":{"id":"00000000-0000-0000-0000-000000000000","generation":0}}`,
		`{"name":"list_links","arguments":{"limit":0}}`,
		`{"name":"list_links","arguments":{"limit":101}}`,
	} {
		w := mcpRequest(h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":`+call+`}`)
		if !strings.Contains(w.Body.String(), `"isError":true`) {
			t.Fatalf("expected tool error: %s", w.Body.String())
		}
	}
	w = mcpRequest(h, `{"jsonrpc":"2.0","id":1,"method":"resources/templates/list"}`)
	if !strings.Contains(w.Body.String(), `"uriTemplate":"linkbook://links/{id}"`) || !strings.Contains(w.Body.String(), `"mimeType":"text/markdown"`) {
		t.Fatalf("template: %s", w.Body.String())
	}
}
