package httpapi

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"

	"linkbook/api/internal/user"
)

const maxLoginBody = 1 << 20

type loginRequestBody struct {
	Email    string `json:"email" binding:"required" format:"email" maxLength:"254"`
	Password string `json:"password" binding:"required" format:"password"`
}

type loginHandler struct {
	users *user.Service
}

// login verifies credentials and issues an opaque browser-session cookie.
// @Summary Log in a user
// @Description Email is trimmed and lowercased; passwords are compared exactly against Argon2id hashes.
// @Description Issues a fresh HttpOnly, Secure, SameSite=Lax linkbook_session cookie. Server sessions expire after 24 hours.
// @Description Unknown users and incorrect passwords return identical errors. Responses use Cache-Control: no-store.
// @Tags users
// @Accept json
// @Produce json
// @Param credentials body loginRequestBody true "Email and password"
// @Success 200 {object} user.User
// @Header 200 {string} Set-Cookie "linkbook_session; HttpOnly; Secure; SameSite=Lax; Path=/"
// @Failure 400 {object} errorResponse "invalid_request, invalid_email or invalid_password"
// @Failure 401 {object} errorResponse "invalid_credentials"
// @Failure 413 {object} errorResponse "request_too_large"
// @Failure 415 {object} errorResponse "unsupported_media_type"
// @Failure 500 {object} errorResponse "internal_error"
// @Router /api/users/login [post]
func (handler loginHandler) login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	request, requestErr := readJSON[loginRequestBody](w, r, maxLoginBody)
	if requestErr != nil {
		writeJSON(w, requestErr.status, errorResponse{Code: requestErr.code})
		return
	}
	authenticated, token, err := handler.users.Login(r.Context(), request.Email, request.Password)
	switch {
	case errors.Is(err, user.ErrInvalidEmail):
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_email"})
	case errors.Is(err, user.ErrInvalidPassword):
		writeJSON(w, http.StatusBadRequest, errorResponse{Code: "invalid_password"})
	case errors.Is(err, user.ErrInvalidCredentials):
		writeJSON(w, http.StatusUnauthorized, errorResponse{Code: "invalid_credentials"})
	case err != nil:
		slog.Error("Login failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{Code: "internal_error"})
	default:
		setSessionCookie(w, token)
		writeJSON(w, http.StatusOK, authenticated)
	}
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, sessionCookie(token))
}

func sessionCookie(token string) *http.Cookie {
	return &http.Cookie{
		Name: "linkbook_session", Value: token, Path: "/",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	}
}

// logoutOriginAllowed accepts the configured origin and its equivalent local
// browser address. Public hosts still require an exact match.
func logoutOriginAllowed(configured, requested string) bool {
	if requested == configured {
		return true
	}
	origin, err := url.Parse(configured)
	if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") ||
		configured != origin.Scheme+"://"+origin.Host {
		return false
	}

	var alias string
	switch origin.Hostname() {
	case "localhost":
		alias = "127.0.0.1"
	case "127.0.0.1":
		alias = "localhost"
	default:
		return false
	}
	if port := origin.Port(); port != "" {
		alias = net.JoinHostPort(alias, port)
	}
	return requested == origin.Scheme+"://"+alias
}

// logout revokes the current browser session and clears its cookie.
// @Summary Log out the current browser session
// @Description Requires the configured PUBLIC_ORIGIN through the loopback proxy. localhost and 127.0.0.1 are interchangeable at the same scheme and port. Repeated logout succeeds. Other sessions and MCP tokens remain valid.
// @Tags users
// @Produce json
// @Success 204
// @Header 204 {string} Set-Cookie "Expired linkbook_session; HttpOnly; Secure; SameSite=Lax; Path=/"
// @Failure 403 {object} errorResponse "forbidden_origin"
// @Failure 500 {object} errorResponse "internal_error"
// @Router /api/users/logout [post]
func (h libraryHandler) logout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !allowBrowserMutation(w, r, logoutOriginAllowed(h.origin, r.Header.Get("Origin"))) {
		return
	}
	if cookie, err := r.Cookie("linkbook_session"); err == nil {
		if err := h.users.Logout(r.Context(), cookie.Value); err != nil {
			slog.Error("Logout failed", "error", err)
			writeJSON(w, http.StatusInternalServerError, errorResponse{Code: "internal_error"})
			return
		}
	}
	cookie := sessionCookie("")
	cookie.MaxAge = -1
	cookie.Expires = time.Unix(0, 0).UTC()
	http.SetCookie(w, cookie)
	w.WriteHeader(http.StatusNoContent)
}
