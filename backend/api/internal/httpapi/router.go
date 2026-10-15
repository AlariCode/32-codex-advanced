package httpapi

import (
	"database/sql"
	"net/http"

	"linkbook/api/internal/user"
)

func NewHandler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health)
	users := user.NewService(db)
	registration := registrationHandler{users: users}
	mux.HandleFunc("POST /api/users/register", registration.register)
	login := loginHandler{users: users}
	mux.HandleFunc("POST /api/users/login", login.login)
	library := newLibraryHandler(db)
	mux.HandleFunc("GET /api/users/me", library.me)
	mux.HandleFunc("GET /api/links", library.list)
	mux.HandleFunc("POST /api/links", library.save)
	mux.HandleFunc("GET /api/links/statuses", library.statuses)
	mux.HandleFunc("GET /api/links/{id}/document", library.document)
	mux.HandleFunc("GET /api/links/{id}", library.get)
	return mux
}

type healthResponse struct {
	Status string `json:"status"`
}

// health reports that the HTTP process is running.
// @Summary Check HTTP process health
// @Tags health
// @Produce json
// @Success 200 {object} healthResponse
// @Router /healthz [get]
func health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}
