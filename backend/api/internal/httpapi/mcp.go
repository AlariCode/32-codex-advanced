package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"linkbook/api/internal/link"
	"linkbook/api/internal/user"
)

func mountMCP(mux *http.ServeMux, db *sql.DB, links *link.Service) {
	users := user.NewService(db)
	mux.Handle("/mcp", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		values := r.Header.Values("Authorization")
		var token string
		if len(values) == 1 {
			parts := strings.Split(values[0], " ")
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				token = parts[1]
			}
		}
		owner, err := users.MCPTokenOwner(r.Context(), token)
		if errors.Is(err, user.ErrInvalidCredentials) || errors.Is(err, sql.ErrNoRows) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="linkbook-mcp"`)
			writeJSON(w, 401, errorResponse{"unauthorized"})
			return
		}
		if err != nil {
			writeJSON(w, 500, errorResponse{"internal_error"})
			return
		}
		newMCPHandler(links, owner).ServeHTTP(w, r)
	}))
}

type mcpSaveInput struct {
	URL string `json:"url" jsonschema:"Absolute HTTP or HTTPS URL to save"`
}

type mcpSaveOutput struct {
	ID      string `json:"id"`
	URL     string `json:"url"`
	Created bool   `json:"created"`
}

// newMCPHandler exposes the SDK's Streamable HTTP transport without sessions.
// @Summary MCP server (Bearer token)
// @Description Stateless Streamable HTTP JSON-RPC with save/list/get/retry/delete tools and linkbook://links/{id} Markdown resources. Requires a profile-issued MCP Bearer token; every request is authorized as its owner. All requests containing Origin are forbidden. Tool errors use result.isError. See backend/api/mcp.md for the MCP contract.
// @Tags mcp
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Failure 403 {string} string "Origin is not allowed"
// @Param Authorization header string true "Bearer MCP token"
// @Failure 401 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /mcp [post]
func newMCPHandler(links *link.Service, owner string) http.Handler {
	server := mcp.NewServer(&mcp.Implementation{Name: "linkbook", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "save_link",
		Description: "Save a URL in the user's library and queue article processing; duplicates return the existing link. Call when the user asks to save a link.",
		Annotations: mcpAnnotations(false, false, true),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input mcpSaveInput) (*mcp.CallToolResult, mcpSaveOutput, error) {
		card, created, err := links.Save(ctx, owner, input.URL)
		if errors.Is(err, link.ErrInvalidURL) {
			return nil, mcpSaveOutput{}, errors.New("Invalid URL: provide an absolute http:// or https:// URL with a host, without credentials, spaces or backslashes, at most 64 KiB")
		}
		if err != nil {
			slog.Error("MCP save_link failed")
			return nil, mcpSaveOutput{}, errors.New("Could not save the link. Please try again later")
		}
		return nil, mcpSaveOutput{ID: card.ID, URL: card.SubmittedURL, Created: created}, nil
	})
	registerMCPTools(server, links, owner)
	registerMCPArticle(server, links, owner)
	transport := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, present := r.Header["Origin"]; present {
			http.Error(w, "Origin is not allowed", http.StatusForbidden)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
		transport.ServeHTTP(w, r)
	})
}

type mcpListInput struct {
	Cursor string `json:"cursor,omitempty" jsonschema:"Opaque next_cursor from list_links; omit for the first page"`
	Limit  *int   `json:"limit,omitempty" jsonschema:"Number of links per page, 1 to 100; defaults to 20"`
}
type mcpIDInput struct {
	ID string `json:"id" jsonschema:"UUID of a saved link returned by save_link or list_links"`
}
type mcpRetryInput struct {
	ID         string `json:"id" jsonschema:"UUID of the failed or unavailable link to retry"`
	Generation int    `json:"generation" jsonschema:"Positive generation observed in get_link; reuse the same value when repeating a lost retry request"`
}
type mcpCard struct {
	link.Card
	Warnings    []string `json:"warnings"`
	ResourceURI string   `json:"resource_uri"`
}
type mcpPage struct {
	Links      []mcpCard `json:"links"`
	NextCursor string    `json:"next_cursor"`
	ServerTime time.Time `json:"server_time"`
}
type mcpDeleteOutput struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

func mcpAnnotations(readOnly, destructive, idempotent bool) *mcp.ToolAnnotations {
	closed := false
	return &mcp.ToolAnnotations{ReadOnlyHint: readOnly, DestructiveHint: &destructive, OpenWorldHint: &closed, IdempotentHint: idempotent}
}
func mcpLinkCard(card link.Card) mcpCard {
	warnings := []string{}
	_ = json.Unmarshal(card.Warnings, &warnings)
	return mcpCard{Card: card, Warnings: warnings, ResourceURI: "linkbook://links/" + card.ID}
}
func mcpLinkError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, sql.ErrNoRows):
		return errors.New("Link not found in this user's library. Use list_links to find an existing ID")
	case errors.Is(err, link.ErrInvalidCursor):
		return errors.New("Invalid cursor. Use next_cursor from list_links or omit cursor to start again")
	case errors.Is(err, link.ErrRetryConflict):
		return errors.New("Retry conflict: call get_link and use its generation; retry is allowed only for failed or unavailable links")
	case errors.Is(err, link.ErrNotReady):
		return errors.New("Article is not ready. Call get_link to check processing status before reading again")
	case errors.Is(err, link.ErrUnavailable):
		return errors.New("Article is unavailable. Call get_link and consider retry_link with its generation")
	default:
		slog.Error("MCP link operation failed")
		return errors.New("Could not access the link. Please try again later")
	}
}
func mcpValidateID(id string) error {
	if !link.ValidID(id) {
		return errors.New("Invalid link ID: provide a UUID returned by list_links or save_link")
	}
	return nil
}
func registerMCPTools(server *mcp.Server, links *link.Service, owner string) {
	mcp.AddTool(server, &mcp.Tool{Name: "list_links", Description: "List the user's saved links, newest first, with processing status and article resource_uri. Call to browse the library or find an ID; pass next_cursor to fetch the next page.", Annotations: mcpAnnotations(true, false, false)}, func(ctx context.Context, _ *mcp.CallToolRequest, input mcpListInput) (*mcp.CallToolResult, mcpPage, error) {
		limit := 20
		if input.Limit != nil {
			limit = *input.Limit
		}
		if limit < 1 || limit > 100 {
			return nil, mcpPage{}, errors.New("Invalid limit: use an integer from 1 to 100")
		}
		page, err := links.List(ctx, owner, input.Cursor, limit)
		if err != nil {
			return nil, mcpPage{}, mcpLinkError(err)
		}
		out := mcpPage{Links: make([]mcpCard, 0, len(page.Links)), NextCursor: page.NextCursor, ServerTime: page.ServerTime}
		for _, card := range page.Links {
			out.Links = append(out.Links, mcpLinkCard(card))
		}
		return nil, out, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "get_link", Description: "Get a saved link's metadata, processing state, generation and article resource_uri. Call to check readiness or obtain generation before retry_link.", Annotations: mcpAnnotations(true, false, false)}, func(ctx context.Context, _ *mcp.CallToolRequest, input mcpIDInput) (*mcp.CallToolResult, mcpCard, error) {
		if err := mcpValidateID(input.ID); err != nil {
			return nil, mcpCard{}, err
		}
		card, err := links.Get(ctx, owner, input.ID)
		return nil, mcpLinkCard(card), mcpLinkError(err)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "retry_link", Description: "Restart processing of a failed or unavailable saved link. Call when the user requests another attempt, using generation from get_link; reuse that generation if the response was lost.", Annotations: mcpAnnotations(false, false, true)}, func(ctx context.Context, _ *mcp.CallToolRequest, input mcpRetryInput) (*mcp.CallToolResult, mcpCard, error) {
		if err := mcpValidateID(input.ID); err != nil {
			return nil, mcpCard{}, err
		}
		if input.Generation < 1 {
			return nil, mcpCard{}, errors.New("Invalid generation: use the positive generation returned by get_link")
		}
		card, err := links.Retry(ctx, owner, input.ID, input.Generation)
		return nil, mcpLinkCard(card), mcpLinkError(err)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "delete_link", Description: "Permanently delete a saved link, its archived article and processing jobs. Call when the user asks to remove a link from the library.", Annotations: mcpAnnotations(false, true, true)}, func(ctx context.Context, _ *mcp.CallToolRequest, input mcpIDInput) (*mcp.CallToolResult, mcpDeleteOutput, error) {
		if err := mcpValidateID(input.ID); err != nil {
			return nil, mcpDeleteOutput{}, err
		}
		if err := links.Delete(ctx, owner, input.ID); err != nil {
			return nil, mcpDeleteOutput{}, mcpLinkError(err)
		}
		return nil, mcpDeleteOutput{ID: input.ID, Deleted: true}, nil
	})
}
func registerMCPArticle(server *mcp.Server, links *link.Service, owner string) {
	server.AddResourceTemplate(&mcp.ResourceTemplate{URITemplate: "linkbook://links/{id}", Name: "Saved article", Description: "Read the saved article as Markdown after get_link reports ready. Text is limited to 100 KiB, including a truncation notice when necessary.", MIMEType: "text/markdown"}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		id := strings.TrimPrefix(req.Params.URI, "linkbook://links/")
		if err := mcpValidateID(id); err != nil {
			return nil, err
		}
		doc, err := links.Document(ctx, owner, id)
		if err != nil {
			return nil, mcpLinkError(err)
		}
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "text/markdown", Text: mcpArticleMarkdown(doc)}}}, nil
	})
}
