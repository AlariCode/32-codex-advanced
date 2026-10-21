package link

import "testing"

type titleRow struct {
	state string
	title *string
}

func (r titleRow) Scan(values ...any) error {
	*values[1].(*string) = "https://example.com/article"
	*values[2].(**string) = r.title
	*values[3].(*string) = r.state
	return nil
}
func TestTerminalCardTitleFallback(t *testing.T) {
	title := "Extracted title"
	for _, state := range []string{"ready", "unavailable", "failed"} {
		c, err := scanCard(titleRow{state: state})
		if err != nil || c.Title == nil || *c.Title != "example.com" {
			t.Fatalf("terminal hostname fallback: %+v %v", c, err)
		}
		c, err = scanCard(titleRow{state: state, title: &title})
		if err != nil || c.Title == nil || *c.Title != title {
			t.Fatalf("extraction priority: %+v %v", c, err)
		}
	}
	c, err := scanCard(titleRow{state: "processing"})
	if err != nil || c.Title != nil {
		t.Fatalf("processing remains URL-first: %+v %v", c, err)
	}
}
