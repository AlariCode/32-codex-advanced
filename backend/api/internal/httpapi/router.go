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
