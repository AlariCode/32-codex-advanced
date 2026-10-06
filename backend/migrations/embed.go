package migrations

import "embed"

// Files contains the versioned SQL migrations embedded in the API binary.
//
//go:embed *.sql
var Files embed.FS
