package extract

import (
	"strings"
	"testing"
)

func TestArticlePreservesFirstSectionHeadingWithSharedTitleWord(t *testing.T) {
	title := "Управление памятью в Go: настройки приложения"
	heading := "Стек и куча в Go"
	input := `<html><head><title>` + title + `</title></head><body><article><h1>` + title + `</h1><p>В этом материале рассматриваются практические способы настройки памяти приложения.</p><h2>` + heading + `</h2><p>` + strings.Repeat("Основной текст объясняет размещение данных и приводит подробные примеры поведения приложения. ", 20) + `</p><h2>Заключение</h2><p>Подведём итоги и сохраним все смысловые разделы.</p></article></body></html>`
	r, err := Article([]byte(input), "https://example.com/memory")
	if err != nil || r.Document == nil {
		t.Fatalf("article rejected: %+v %v", r, err)
	}
	for _, b := range r.Document.Blocks {
		if b.Kind == "heading" && b.Level == 2 && documentText(b.Children) == heading {
			return
		}
	}
	t.Fatalf("first section heading lost: %+v", r.Document.Blocks)
}
