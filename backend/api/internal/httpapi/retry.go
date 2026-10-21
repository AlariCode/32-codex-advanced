package httpapi

import (
	"database/sql"
	"errors"
	"net"
	"net/http"

	"linkbook/api/internal/link"
)

type retryLinkRequest struct {
	Generation int `json:"generation" binding:"required" minimum:"1"`
}
type retryLinkResponse struct {
	Link       link.Card `json:"link"`
	ServerTime string    `json:"server_time"`
}

// retry starts one new attempt for an observed failed/unavailable generation.
// @Summary Retry an unavailable or failed article
// @Description Requires a session and matching Origin through the loopback proxy. The observed generation is an idempotency fence: replay after a lost response returns the current card without enqueueing. One active attempt; a new 120-second deadline includes queue time. ID and created_at do not change.
// @Tags links
// @Accept json
// @Produce json
// @Param id path string true "Link UUID"
// @Param retry body retryLinkRequest true "Observed generation"
// @Success 200 {object} retryLinkResponse
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 403 {object} errorResponse
// @Failure 404 {object} errorResponse
// @Failure 409 {object} errorResponse "retry_conflict"
// @Failure 413 {object} errorResponse
// @Failure 415 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/links/{id}/retry [post]
func (h libraryHandler) retry(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	peer := net.ParseIP(host)
	if err != nil || peer == nil || !peer.IsLoopback() || r.Header.Get("Origin") != h.origin {
		writeJSON(w, 403, errorResponse{"forbidden_origin"})
		return
	}
	id := r.PathValue("id")
	if !link.ValidID(id) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	body, requestErr := readJSON[retryLinkRequest](w, r, 1024)
	if requestErr != nil {
		writeJSON(w, requestErr.status, errorResponse{requestErr.code})
		return
	}
	if body.Generation < 1 {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	card, err := h.links.Retry(r.Context(), current.ID, id, body.Generation)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeJSON(w, 404, errorResponse{"not_found"})
	case errors.Is(err, link.ErrRetryConflict):
		writeJSON(w, 409, errorResponse{"retry_conflict"})
	case err != nil:
		writeJSON(w, 500, errorResponse{"internal_error"})
	default:
		writeJSON(w, 200, retryLinkResponse{card, serverTime()})
	}
}
