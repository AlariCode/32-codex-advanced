package httpapi

import (
	"linkbook/api/internal/link"
	"linkbook/linkprocessing"
	"net/http"
)

// asset returns only a verified image referenced by the owner's published document.
// @Summary Read a private archived image
// @Tags links
// @Produce image/png,image/jpeg,image/gif
// @Param id path string true "Link UUID"
// @Param asset_id path string true "Asset ID (64 lowercase hex characters)"
// @Success 200 {file} file "Verified image bytes; Cache-Control: no-store; X-Content-Type-Options: nosniff"
// @Failure 400 {object} errorResponse
// @Failure 401 {object} errorResponse
// @Failure 404 {object} errorResponse
// @Router /api/links/{id}/assets/{asset_id} [get]
func (h libraryHandler) asset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	current, ok := h.authenticated(w, r)
	if !ok {
		return
	}
	id, assetID := r.PathValue("id"), r.PathValue("asset_id")
	if !link.ValidID(id) || !linkprocessing.ValidAssetID(assetID) {
		writeJSON(w, 400, errorResponse{"invalid_request"})
		return
	}
	a, err := h.links.Asset(r.Context(), current.ID, id, assetID)
	if err != nil {
		writeJSON(w, 404, errorResponse{"not_found"})
		return
	}
	w.Header().Set("Content-Type", a.MIME)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(a.Data)
}
