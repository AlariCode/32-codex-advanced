//go:build integration

package worker

import (
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
	"testing"
)

func TestPartialPublicationClassifications(t *testing.T) {
	db := recoveryDB(t)
	var owner string
	if err := db.QueryRowContext(t.Context(), "INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),'partial@example.com','hash') RETURNING id::text").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ body, state string }{
		{"<html><title>Empty</title><body></body></html>", "unavailable"},
	} {
		var id string
		if err := db.QueryRowContext(t.Context(), `INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,'https://example.com','https://example.com',$2,decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner, tc.state).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(t.Context(), `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
		e, err := linkprocessing.Claim(t.Context(), db)
		if err != nil || e == nil {
			t.Fatal(err)
		}
		r := pageResult(safehttp.Page{HTML: []byte(tc.body), FinalURL: "https://example.com", Truncated: true}, nil)
		if ok, err := linkprocessing.Publish(t.Context(), db, *e, r); err != nil || !ok {
			t.Fatalf("publish: %v %v", ok, err)
		}
		var state string
		var snapshots int
		if err := db.QueryRowContext(t.Context(), `SELECT state,(SELECT count(*) FROM snapshots WHERE link_id=$1) FROM links WHERE id=$1`, id).Scan(&state, &snapshots); err != nil {
			t.Fatal(err)
		}
		if state != tc.state || snapshots != 0 {
			t.Fatalf("state %s snapshots %d", state, snapshots)
		}
	}
}
