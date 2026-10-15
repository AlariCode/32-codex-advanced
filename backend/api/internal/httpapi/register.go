package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"linkbook/api/internal/user"
)

const maxRegistrationBody = 1 << 20

type registerRequest struct {
	Email    string `json:"email" binding:"required" format:"email" maxLength:"254"`
	Password string `json:"password" binding:"required" format:"password" minLength:"8"`
}

type registrationHandler struct {
	users *user.Service
}

// register creates a user with a unique normalized email.
// @Summary Register a user
// @Description Email is trimmed and lowercased. Password accepts any characters, minimum 8 Unicode code points.
// @Description Request body is limited to 1 MiB. Passwords and password hashes are never returned.
// @Description Creates the user and a 24-hour session atomically; issues the same secure session cookie as login. Responses are no-store.
// @Header 201 {string} Set-Cookie "linkbook_session; HttpOnly; Secure; SameSite=Lax; Path=/"
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
	w.Header().Set("Cache-Control", "no-store")
	request, requestErr := readJSON[registerRequest](w, r, maxRegistrationBody)
	if requestErr != nil {
		writeJSON(w, requestErr.status, errorResponse{Code: requestErr.code})
		return
	}
	registered, token, err := handler.users.Register(r.Context(), request.Email, request.Password)
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
		setSessionCookie(w, token)
		writeJSON(w, http.StatusCreated, registered)
	}
}
