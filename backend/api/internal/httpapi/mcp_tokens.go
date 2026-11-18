package httpapi

import (
	"linkbook/api/internal/link"
	"linkbook/api/internal/user"
	"net/http"
)

// listMCPTokens returns metadata, never secrets or hashes.
// @Summary List current user's MCP tokens
// @Tags mcp
// @Produce json
// @Success 200 {array} user.MCPToken
// @Failure 401 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/users/me/mcp-tokens [get]
func (h libraryHandler) listMCPTokens(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	tokens, err := h.users.ListMCPTokens(r.Context(), current.ID)
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	writeJSON(w, 200, tokens)
}

// createMCPToken returns the secret once; only its SHA-256 digest is persisted.
// @Summary Create an MCP token (secret returned once)
// @Description Requires session cookie and matching PUBLIC_ORIGIN through loopback proxy. Grants full MCP access to the owner's library until revoked. Response is no-store.
// @Tags mcp
// @Produce json
// @Success 201 {object} user.CreatedMCPToken
// @Failure 401 {object} errorResponse
// @Failure 403 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/users/me/mcp-tokens [post]
func (h libraryHandler) createMCPToken(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok || !h.browserMutationAllowed(w, r) {
		return
	}
	token, err := h.users.CreateMCPToken(r.Context(), current.ID)
	if err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	writeJSON(w, 201, user.CreatedMCPToken(token))
}

// revokeMCPToken deletes only a token owned by the current session user.
// @Summary Revoke an MCP token
// @Tags mcp
// @Param id path string true "Token UUID"
// @Success 204 "Revoked (also for missing or foreign IDs)"
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 403 {object} errorResponse
// @Failure 500 {object} errorResponse
// @Router /api/users/me/mcp-tokens/{id} [delete]
func (h libraryHandler) revokeMCPToken(w http.ResponseWriter, r *http.Request) {
	current, ok := h.authenticated(w, r)
	if !ok || !h.browserMutationAllowed(w, r) {
		return
	}
	id := r.PathValue("id")
	if !link.ValidID(id) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	if err := h.users.RevokeMCPToken(r.Context(), current.ID, id); err != nil {
		writeJSON(w, 500, errorResponse{"internal_error"})
		return
	}
	w.WriteHeader(204)
}
