package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
)

type requestError struct {
	status int
	code   string
}

// readJSON accepts exactly one non-null JSON object with known fields.
func readJSON[T any](w http.ResponseWriter, r *http.Request, limit int64) (*T, *requestError) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, &requestError{http.StatusUnsupportedMediaType, "unsupported_media_type"}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, &requestError{http.StatusRequestEntityTooLarge, "request_too_large"}
		}
		return nil, &requestError{http.StatusBadRequest, "invalid_request"}
	}
	var request *T
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request == nil {
		return nil, &requestError{http.StatusBadRequest, "invalid_request"}
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, &requestError{http.StatusBadRequest, "invalid_request"}
	}
	return request, nil
}
