package linkprocessing

import _ "embed"

// DiagnosticsSQL is the same read-only snapshot operators run with psql.
// It deliberately selects neither URLs/content nor authentication material.
//
//go:embed diagnostics.sql
var DiagnosticsSQL string
