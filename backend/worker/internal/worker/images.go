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
type budgetImageFetcher interface {
	FetchImageBudget(context.Context, string, int) ([]byte, error)
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
	count, used, attempts := 0, 0, 0
	seen := map[string]bool{}
	omitted := false
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for i := range bs {
			b := &bs[i]
			if b.Kind == "image" {
				candidates := b.Candidates
				if len(candidates) == 0 && b.Source != "" {
					candidates = []string{b.Source}
				}
				b.Candidates = nil
				b.Source = ""
				count++
				b.Omission = "image_source_unsupported"
				switch {
				case count > linkprocessing.MaxImages:
					b.Omission = "image_count_limit"
				case used >= linkprocessing.MaxAssetBytes:
					b.Omission = "image_total_limit"
				case client == nil:
					b.Omission = "image_fetch_failed"
				default:
					for j, source := range candidates {
						if j >= 8 || attempts >= 100 || ctx.Err() != nil {
							b.Omission = "image_fetch_failed"
							break
						}
						if used >= linkprocessing.MaxAssetBytes {
							b.Omission = "image_total_limit"
							break
						}
						attempts++
						remaining := linkprocessing.MaxAssetBytes - used
						var data []byte
						var err error
						if bounded, ok := client.(budgetImageFetcher); ok {
							data, err = bounded.FetchImageBudget(ctx, source, remaining)
						} else {
							data, err = client.FetchImage(ctx, source)
						}
						// Include failed/corrupt candidates and repeated positions in the budget.
						charged := min(len(data), linkprocessing.MaxImageBytes, remaining)
						used += charged
						if ctx.Err() != nil {
							b.Omission = "image_fetch_failed"
							break
						}
						switch {
						case len(data) > remaining || safehttp.Code(err) == "image_total_limit":
							b.Omission = "image_total_limit"
						case len(data) > linkprocessing.MaxImageBytes || safehttp.Code(err) == "image_too_large":
							b.Omission = "image_too_large"
						case err != nil:
							b.Omission = "image_fetch_failed"
						default:
							mime, decodeErr := linkprocessing.ValidateImage(data)
							if decodeErr != nil {
								b.Omission = "image_invalid"
								continue
							}
							b.AssetID = fmt.Sprintf("%x", sha256.Sum256(append([]byte(source+"\x00"), data...)))
							b.Omission = ""
							if !seen[b.AssetID] {
								seen[b.AssetID] = true
								r.Assets = append(r.Assets, linkprocessing.Asset{ID: b.AssetID, MIME: mime, Data: data})
							}
						}
						if b.AssetID != "" {
							break
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
		found := false
		for _, w := range r.Warnings {
			if w == "images_omitted" {
				found = true
			}
		}
		if !found {
			r.Warnings = append(r.Warnings, "images_omitted")
		}
	}
}
