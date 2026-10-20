package link

import (
	"context"
	"database/sql"
	"linkbook/linkprocessing"
)

func (s *Service) Asset(ctx context.Context, owner, id, assetID string) (linkprocessing.Asset, error) {
	// Decode the current published document before granting access to a row.
	doc, err := s.Document(ctx, owner, id)
	if err != nil {
		return linkprocessing.Asset{}, err
	}
	if !linkprocessing.AssetReferences(doc.Document)[assetID] {
		return linkprocessing.Asset{}, sql.ErrNoRows
	}
	var a linkprocessing.Asset
	a.ID = assetID
	err = s.db.QueryRowContext(ctx, `SELECT a.mime,a.data FROM assets a JOIN links l ON l.id=a.link_id JOIN snapshots s ON s.link_id=l.id AND s.generation=l.generation WHERE a.link_id=$1 AND a.generation=$2 AND a.id=$3 AND l.user_id=$4 AND l.state='ready' AND a.generation=l.generation`, id, doc.Generation, assetID, owner).Scan(&a.MIME, &a.Data)
	if err != nil {
		return a, err
	}
	mime, err := linkprocessing.ValidateImage(a.Data)
	if err != nil || mime != a.MIME {
		return linkprocessing.Asset{}, sql.ErrNoRows
	}
	return a, nil
}
