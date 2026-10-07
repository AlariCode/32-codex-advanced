package user

import (
	"crypto/rand"
	"fmt"
)

func newID() string {
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		id[:4],
		id[4:6],
		id[6:8],
		id[8:10],
		id[10:],
	)
}
