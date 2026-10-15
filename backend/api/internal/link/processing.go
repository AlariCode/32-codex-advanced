package link

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"linkbook/linkprocessing"
)

var ErrNotReady = errors.New("article_not_ready")
var ErrUnavailable = errors.New("article_unavailable")

type DocumentResponse struct {
	Document     linkprocessing.Document `json:"document"`
	Title        string                  `json:"title"`
	SubmittedURL string                  `json:"submitted_url"`
	Warnings     json.RawMessage         `json:"warnings" swaggertype:"array,string"`
	Generation   int                     `json:"generation"`
}

func (s *Service) Document(ctx context.Context, owner, id string) (DocumentResponse, error) {
	var out DocumentResponse
	var state string
	var version sql.NullInt64
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT l.state,COALESCE(l.title,''),l.submitted_url,l.warnings,l.generation,s.schema_version,s.document
 FROM links l LEFT JOIN snapshots s ON s.link_id=l.id AND s.generation=l.generation WHERE l.user_id=$1 AND l.id=$2`, owner, id).Scan(&state, &out.Title, &out.SubmittedURL, &out.Warnings, &out.Generation, &version, &raw)
	if err != nil {
		return out, err
	}
	if state == "unavailable" {
		return out, ErrUnavailable
	}
	if state != "ready" {
		return out, ErrNotReady
	}
	if !version.Valid || version.Int64 != linkprocessing.SchemaVersion {
		return out, linkprocessing.ErrDocument
	}
	out.Document, err = linkprocessing.DecodeDocument(raw)
	return out, err
}

// Statuses either returns a bounded owner-scoped ID batch, or discovers all
// active cards using keyset pages independently of the visible library page.
func (s *Service) Statuses(ctx context.Context, owner string, ids []string, encoded string, limit int) (Page, error) {
	if len(ids) == 0 {
		return s.list(ctx, owner, encoded, limit, true)
	}
	page := Page{Links: []Card{}, ServerTime: time.Now().UTC()}
	args := []any{owner}
	parts := make([]string, len(ids))
	for i, id := range ids {
		args = append(args, id)
		parts[i] = "$" + strconv.Itoa(i+2)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+columns+` FROM links WHERE user_id=$1 AND id IN (`+strings.Join(parts, ",")+`) ORDER BY created_at DESC,id DESC`, args...)
	if err != nil {
		return page, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		card, err := scanCard(rows)
		if err != nil {
			return page, err
		}
		page.Links = append(page.Links, card)
	}
	return page, rows.Err()
}
