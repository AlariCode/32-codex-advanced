package link

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"linkbook/linkprocessing"
)

var ErrInvalidURL = errors.New("invalid URL")
var ErrInvalidCursor = errors.New("invalid cursor")

type Card struct {
	ID           string          `json:"id"`
	SubmittedURL string          `json:"submitted_url"`
	Title        *string         `json:"title"`
	State        string          `json:"state"`
	Generation   int             `json:"generation"`
	Reason       *string         `json:"reason"`
	Warnings     json.RawMessage `json:"warnings" swaggertype:"array,string"`
	CreatedAt    time.Time       `json:"created_at"`
	RequestedAt  time.Time       `json:"requested_at"`
	DeadlineAt   time.Time       `json:"deadline_at"`
	CanRead      bool            `json:"can_read"`
}
type Page struct {
	Links      []Card    `json:"links"`
	NextCursor string    `json:"next_cursor"`
	ServerTime time.Time `json:"server_time"`
}
type Service struct{ db *sql.DB }

func NewService(db *sql.DB) *Service { return &Service{db: db} }

const columns = `id::text,submitted_url,title,state,generation,reason,warnings,created_at,requested_at,deadline_at`

type scanner interface{ Scan(...any) error }

func scanCard(row scanner) (Card, error) {
	var c Card
	err := row.Scan(&c.ID, &c.SubmittedURL, &c.Title, &c.State, &c.Generation, &c.Reason, &c.Warnings, &c.CreatedAt, &c.RequestedAt, &c.DeadlineAt)
	c.CanRead = c.State == "ready"
	return c, err
}

func prepareURL(raw string) (submitted, fetch, key string, err error) {
	submitted = strings.TrimSpace(raw)
	// Keep long URL support without accepting unbounded bodies, embedded credentials,
	// invalid UTF-8 or browser-normalized backslashes/whitespace.
	if len(submitted) > 64*1024 || !utf8.ValidString(submitted) || strings.ContainsAny(submitted, "\\\r\n\t ") {
		err = ErrInvalidURL
		return
	}
	parsed, e := url.Parse(submitted)
	if e != nil || parsed.User != nil || parsed.Opaque != "" {
		err = ErrInvalidURL
		return
	}
	key, e = NormalizeURL(submitted)
	if e != nil {
		err = ErrInvalidURL
		return
	}
	parsed.Fragment = ""
	parsed.RawFragment = ""
	fetch = parsed.String()
	return
}

func (s *Service) Save(ctx context.Context, owner, raw string) (Card, bool, error) {
	submitted, fetch, key, err := prepareURL(raw)
	if err != nil {
		return Card{}, false, err
	}
	digest := sha256.Sum256([]byte(key))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Card{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	// Serialize each owner/digest bucket. The UNIQUE constraint arbitrates slots;
	// the full key decides equality, including the (rare) digest collision case.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, owner+fmt.Sprintf("%x", digest)); err != nil {
		return Card{}, false, err
	}
	existing, err := scanCard(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM links WHERE user_id=$1 AND dedup_digest=$2 AND dedup_key=$3`, owner, digest[:], key))
	if err == nil {
		return existing, false, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Card{}, false, err
	}
	var id string
	err = tx.QueryRowContext(ctx, `INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot)
 SELECT $1,$2,$3,$4,$5,COALESCE(MAX(dedup_slot)+1,0) FROM links WHERE user_id=$1 AND dedup_digest=$5 RETURNING id::text`, owner, submitted, fetch, key, digest[:]).Scan(&id)
	if err != nil {
		return Card{}, false, err
	}
	if err = linkprocessing.EnqueueInitial(ctx, tx, id); err != nil {
		return Card{}, false, err
	}
	if err = linkprocessing.StartInitialBudget(ctx, tx, id); err != nil {
		return Card{}, false, err
	}
	card, err := scanCard(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM links WHERE id=$1`, id))
	if err != nil {
		return Card{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return Card{}, false, err
	}
	return card, true, nil
}
func (s *Service) Get(ctx context.Context, owner, id string) (Card, error) {
	return scanCard(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM links WHERE user_id=$1 AND id=$2`, owner, id))
}

type cursor struct {
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"i"`
}

func ValidID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, c := range id {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
func (s *Service) List(ctx context.Context, owner, encoded string, limit int) (Page, error) {
	return s.list(ctx, owner, encoded, limit, false)
}
func (s *Service) list(ctx context.Context, owner, encoded string, limit int, active bool) (Page, error) {
	page := Page{Links: []Card{}}
	var after cursor
	if encoded != "" {
		if len(encoded) > 512 {
			return page, ErrInvalidCursor
		}
		b, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			return page, ErrInvalidCursor
		}
		if err = json.Unmarshal(b, &after); err != nil || after.CreatedAt.IsZero() || !ValidID(after.ID) {
			return page, ErrInvalidCursor
		}
	}
	query := `SELECT ` + columns + ` FROM links WHERE user_id=$1`
	args := []any{owner, limit + 1}
	if active {
		query += ` AND state='processing'`
	}
	if encoded != "" {
		query += ` AND (created_at,id)<($3,$4)`
		args = append(args, after.CreatedAt, after.ID)
	}
	rows, err := s.db.QueryContext(ctx, query+` ORDER BY created_at DESC,id DESC LIMIT $2`, args...)
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
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Links) > limit {
		page.Links = page.Links[:limit]
		last := page.Links[limit-1]
		b, _ := json.Marshal(cursor{last.CreatedAt, last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	page.ServerTime = time.Now().UTC()
	return page, nil
}
