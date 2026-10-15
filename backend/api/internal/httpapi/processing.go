package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"linkbook/api/internal/link"
	"linkbook/linkprocessing"
)

// statuses returns a bounded batch, or a keyset page of active cards.
// @Summary Poll current user's link statuses
// @Description Expired processing attempts are failed with reason timeout, independently of worker availability. server_time anchors the 30-second waiting message; reload does not reset requested_at or deadline_at.
// @Tags links
// @Produce json
// @Param ids query string false "Up to 100 comma-separated UUIDs; omitted to discover processing cards"
// @Param limit query int false "Active page size, 1–100"
// @Param cursor query string false "Active keyset cursor"
// @Success 200 {object} link.Page
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/links/statuses [get]
func (h libraryHandler) statuses(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	ids := []string{}
	limit := 100
	for _, name := range []string{"ids", "cursor", "limit"} {
		if len(q[name]) > 1 {
			writeJSON(w, 400, errorResponse{"invalid_request"})
			return
		}
	}
	if raw, exists := q["ids"]; exists {
		ids = strings.Split(raw[0], ",")
		if len(ids) > 100 || q.Get("cursor") != "" {
			writeJSON(w, 400, errorResponse{"invalid_request"})
			return
		}
		for _, id := range ids {
			if !link.ValidID(id) {
				writeJSON(w, 400, errorResponse{"invalid_request"})
				return
			}
		}
	}
	if raw, exists := q["limit"]; exists {
		var err error
		limit, err = strconv.Atoi(raw[0])
		if err != nil || limit < 1 || limit > 100 {
			writeJSON(w, 400, errorResponse{"invalid_request"})
			return
		}
	}
	page, err := h.links.Statuses(r.Context(), current.ID, ids, q.Get("cursor"), limit)
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

// document returns the versioned text archive, never source HTML.
// @Summary Read an archived text article
// @Tags links
// @Produce json
// @Param id path string true "Link UUID"
// @Success 200 {object} link.DocumentResponse
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 404 {object} errorResponse
// @Failure 409 {object} errorResponse "article_not_ready, article_unavailable or unsupported_document"
// @Failure 500 {object} errorResponse
// @Router /api/links/{id}/document [get]
func (h libraryHandler) document(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !link.ValidID(id) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	doc, err := h.links.Document(r.Context(), current.ID, id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeJSON(w, 404, errorResponse{"not_found"})
	case errors.Is(err, link.ErrNotReady), errors.Is(err, link.ErrUnavailable), errors.Is(err, linkprocessing.ErrDocument):
		writeJSON(w, 409, errorResponse{err.Error()})
	case err != nil:
		writeJSON(w, 500, errorResponse{"internal_error"})
	default:
		writeJSON(w, 200, doc)
	}
}
