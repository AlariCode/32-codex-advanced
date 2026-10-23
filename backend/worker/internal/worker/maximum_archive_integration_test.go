//go:build integration

package worker

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

type maximumArchiveFixture struct{ image []byte }

func (f maximumArchiveFixture) Fetch(context.Context, string) (safehttp.Page, error) {
	var images strings.Builder
	for i := 0; i < 5; i++ {
		fmt.Fprintf(&images, `<figure><img src="https://example.com/image-%d" alt="Photo %d"></figure>`, i, i)
	}
	return safehttp.Page{FinalURL: "https://example.com/article", HTML: []byte(`<html><title>Maximum archive</title><body><article><h1>Maximum archive</h1><p>` + strings.Repeat("The archive retains the article and its saved images independently of the source. ", 40) + `</p>` + images.String() + `</article></body></html>`)}, nil
}
func (f maximumArchiveFixture) FetchImage(context.Context, string) ([]byte, error) {
	return f.image, nil
}

// The accepted 20 MiB archive must be published. A publication failure must
// not strand an otherwise valid job.
func TestMaximumImageArchivePublication(t *testing.T) {
	db := recoveryDB(t)
	var owner, id string
	if err := db.QueryRowContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),'maximum-archive@example.com','hash') RETURNING id::text`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(t.Context(), `INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,'https://example.com/article','https://example.com/article','maximum',decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	execution, err := linkprocessing.Claim(t.Context(), db)
	if err != nil || execution == nil {
		t.Fatalf("claim: %v", err)
	}
	png, err := os.ReadFile("../../../../web/tests/fixtures/images/archive.png")
	if err != nil {
		t.Fatal(err)
	}
	image := make([]byte, linkprocessing.MaxImageBytes)
	copy(image, png)
	started := time.Now()
	if err = process(t.Context(), db, maximumArchiveFixture{image: image}, *execution); err != nil {
		t.Fatalf("maximum archive publication after %s: %v", time.Since(started), err)
	}
	var state, jobState string
	var assets, storedBytes int
	if err = db.QueryRowContext(t.Context(), `SELECT l.state,j.state,(SELECT count(*) FROM assets WHERE link_id=l.id),(SELECT coalesce(sum(octet_length(data)),0) FROM assets WHERE link_id=l.id) FROM links l JOIN processing_jobs j ON j.link_id=l.id WHERE l.id=$1`, id).Scan(&state, &jobState, &assets, &storedBytes); err != nil {
		t.Fatal(err)
	}
	if state != "ready" || jobState != "completed" || assets != 4 || storedBytes != linkprocessing.MaxAssetBytes {
		t.Fatalf("state=%s job=%s assets=%d bytes=%d", state, jobState, assets, storedBytes)
	}
	t.Logf("published maximum archive in %s", time.Since(started))
}
