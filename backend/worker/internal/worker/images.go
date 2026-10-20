package worker

import (
	"context"
	"crypto/sha256"
	"fmt"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

type ImageFetcher interface {
	FetchImage(context.Context, string) ([]byte, error)
}

func archiveImages(ctx context.Context, client ImageFetcher, r *linkprocessing.Result) {
	if r.Document == nil {
		return
	}
	warnings := r.Warnings[:0]
	for _, w := range r.Warnings {
		if w != "images_pending" {
			warnings = append(warnings, w)
		}
	}
	r.Warnings = warnings
	count, total := 0, 0
	seen := map[string]bool{}
	omitted := false
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for i := range bs {
			b := &bs[i]
			if b.Kind == "image" {
				source := b.Source
				b.Source = ""
				count++
				switch {
				case count > linkprocessing.MaxImages:
					b.Omission = "image_count_limit"
				case source == "":
					b.Omission = "image_source_unsupported"
				case total >= linkprocessing.MaxAssetBytes:
					b.Omission = "image_total_limit"
				case client == nil:
					b.Omission = "image_fetch_failed"
				default:
					data, err := client.FetchImage(ctx, source)
					if err != nil {
						b.Omission = "image_fetch_failed"
						if safehttp.Code(err) == "image_too_large" {
							b.Omission = "image_too_large"
						}
					} else if len(data) > linkprocessing.MaxImageBytes {
						b.Omission = "image_too_large"
					} else if len(data) > linkprocessing.MaxAssetBytes-total {
						b.Omission = "image_total_limit"
					} else if mime, err := linkprocessing.ValidateImage(data); err != nil {
						b.Omission = "image_invalid"
					} else {
						total += len(data)
						b.AssetID = fmt.Sprintf("%x", sha256.Sum256(append([]byte(source+"\x00"), data...)))
						b.Omission = ""
						if !seen[b.AssetID] {
							seen[b.AssetID] = true
							r.Assets = append(r.Assets, linkprocessing.Asset{ID: b.AssetID, MIME: mime, Data: data})
						}
					}
				}
				if b.Omission != "" {
					omitted = true
				}
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	if omitted {
		r.Warnings = append(r.Warnings, "images_omitted")
	}
}
