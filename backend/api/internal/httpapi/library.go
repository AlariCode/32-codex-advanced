package httpapi

import (
	"database/sql"
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"linkbook/api/internal/link"
	"linkbook/api/internal/user"
)

type libraryHandler struct {
	users  *user.Service
	links  *link.Service
	origin string
}

func newLibraryHandler(db *sql.DB) libraryHandler {
	origin := os.Getenv("PUBLIC_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	return libraryHandler{user.NewService(db), link.NewService(db), origin}
}
func (h libraryHandler) authenticated(w http.ResponseWriter, r *http.Request) (user.User, bool) {
	w.Header().Set("Cache-Control", "no-store")
	cookie, err := r.Cookie("linkbook_session")
	if err != nil {
		writeJSON(w, 401, errorResponse{"unauthorized"})
		return user.User{}, false
	}
	current, err := h.users.Current(r.Context(), cookie.Value)
	if errors.Is(err, user.ErrInvalidCredentials) || errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 401, errorResponse{"unauthorized"})
		return user.User{}, false
	}
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return user.User{}, false
	}
	return current, true
}

// me verifies the existing session without exposing its token.
// @Summary Get current user
// @Tags users
// @Produce json
// @Success 200 {object} user.User
// @Failure 401 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/users/me [get]
func (h libraryHandler) me(w http.ResponseWriter, r *http.Request) {
	if current, ok := h.authenticated(w, r); ok {
		writeJSON(w, 200, current)
	}
}

type saveLinkRequest struct {
	URL string `json:"url"`
}
type saveLinkResponse struct {
	Link       link.Card `json:"link"`
	Created    bool      `json:"created"`
	ServerTime string    `json:"server_time"`
}

// save persists a card and its initial durable job in one transaction.
// @Summary Save a link in the current user's library
// @Description Requires session cookie and Origin matching PUBLIC_ORIGIN, through the loopback Next.js proxy. Private responses are no-store. Normalized duplicates return the existing card without enqueueing again.
// @Tags links
// @Accept json
// @Produce json
// @Param link body saveLinkRequest true "Submitted HTTP(S) URL"
// @Success 201 {object} saveLinkResponse "Created"
// @Success 200 {object} saveLinkResponse "Already saved"
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 403 {object} errorResponse
// @Failure 413 {object} errorResponse
// @Failure 415 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/links [post]
func (h libraryHandler) save(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	// API binds loopback; never trust caller-supplied forwarded host/proto headers.
	// PUBLIC_ORIGIN is a server setting, independent of Host and forwarded headers.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	peer := net.ParseIP(host)
	if err != nil || peer == nil || !peer.IsLoopback() || r.Header.Get("Origin") != h.origin {
		writeJSON(w, 403, errorResponse{"forbidden_origin"})
		return
	}
	body, requestErr := readJSON[saveLinkRequest](w, r, 128*1024)
	if requestErr != nil {
		writeJSON(w, requestErr.status, errorResponse{requestErr.code})
		return
	}
	card, created, err := h.links.Save(r.Context(), current.ID, body.URL)
	if errors.Is(err, link.ErrInvalidURL) {
		writeJSON(w, 400, errorResponse{"invalid_url"})
		return
	}
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	status := 200
	if created {
		status = 201
	}
	writeJSON(w, status, saveLinkResponse{Link: card, Created: created, ServerTime: serverTime()})
}

// list returns owner-scoped metadata in stable keyset order.
// @Summary List current user's links
// @Tags links
// @Produce json
// @Param limit query int false "Page size (1–100, default 20)"
// @Param cursor query string false "Opaque keyset cursor"
// @Success 200 {object} link.Page
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/links [get]
func (h libraryHandler) list(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	limit := 20
	var err error
	if raw, exists := r.URL.Query()["limit"]; exists {
		if len(raw) != 1 {
			writeJSON(w, 400, errorResponse{"invalid_request"})
			return
		}
		limit, err = strconv.Atoi(raw[0])
		if err != nil || limit < 1 || limit > 100 {
			writeJSON(w, 400, errorResponse{"invalid_request"})
			return
		}
	}
	page, err := h.links.List(r.Context(), current.ID, r.URL.Query().Get("cursor"), limit)
	if errors.Is(err, link.ErrInvalidCursor) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	writeJSON(w, 200, page)
}

// get returns only metadata belonging to the verified session owner.
// @Summary Get a saved link
// @Tags links
// @Produce json
// @Param id path string true "Link UUID"
// @Success 200 {object} link.Card
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 404 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/links/{id} [get]
func (h libraryHandler) get(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !link.ValidID(id) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	card, err := h.links.Get(r.Context(), current.ID, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, errorResponse{"not_found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	writeJSON(w, 200, card)
}

func serverTime() string { return time.Now().UTC().Format(time.RFC3339Nano) }
