package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"linkbook/api/internal/user"
)

const maxRegistrationBody = 1 << 20

type registerRequest struct {
	Email    string `json:"email" binding:"required" format:"email" maxLength:"254"`
	Password string `json:"password" binding:"required" format:"password" minLength:"8"`
}

type errorResponse struct {
	Code string `json:"code"`
}

type registrationHandler struct {
	users *user.Service
}

// register creates a user with a unique normalized email.
// @Summary Register a user
// @Description Email is trimmed and lowercased. Password accepts any characters, minimum 8 Unicode code points.
// @Description Request body is limited to 1 MiB. Passwords and password hashes are never returned.
// @Tags users
// @Accept json
// @Produce json
// @Param registration body registerRequest true "Email and password"
// @Success 201 {object} user.User
// @Failure 400 {object} errorResponse "invalid_request, invalid_email or invalid_password"
// @Failure 409 {object} errorResponse "email_exists"
// @Failure 413 {object} errorResponse "request_too_large"
// @Failure 415 {object} errorResponse "unsupported_media_type"
// @Failure 500 {object} errorResponse "internal_error"
// @Router /api/users/register [post]
func (handler registrationHandler) register(w http.ResponseWriter, r *http.Request) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{Code: "unsupported_media_type"})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRegistrationBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Code: "request_too_large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_request"})
		return
	}
	var request *registerRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request == nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_request"})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_request"})
		return
	}
	registered, err := handler.users.Register(r.Context(), request.Email, request.Password)
	switch {
	case errors.Is(err, user.ErrInvalidEmail):
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_email"})
	case errors.Is(err, user.ErrInvalidPassword):
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_password"})
	case errors.Is(err, user.ErrEmailExists):
		writeJSON(w, http.StatusConflict, errorResponse{Code: "email_exists"})
	case err != nil:
		slog.Error("Registration failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{Code: "internal_error"})
	default:
		writeJSON(w, http.StatusCreated, registered)
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("Write JSON response failed", "error", err)
	}
}
