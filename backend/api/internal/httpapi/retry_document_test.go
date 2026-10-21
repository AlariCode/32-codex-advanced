package httpapi

import (
	"testing"

	"linkbook/linkprocessing"
)

// Keep the SQL publication fixture covered by make check without PostgreSQL.
func correctedRetryDocument() linkprocessing.Document {
	return linkprocessing.Document{
		SchemaVersion: linkprocessing.SchemaVersion,
		Blocks: []linkprocessing.Block{{
			Kind: "paragraph",
			Children: []linkprocessing.Block{{
				Kind: "text",
				Text: "The corrected source now contains a readable archived article.",
			}},
		}},
	}
}

func TestRetryPublicationDocumentFixture(t *testing.T) {
	if err := linkprocessing.ValidateDocument(correctedRetryDocument()); err != nil {
		t.Fatalf("corrected source fixture must be publishable: %v", err)
	}
}
