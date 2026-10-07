package user

import (
	"net/mail"
	"strings"
)

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || len(email) > 254 {
		return "", ErrInvalidEmail
	}
	address, err := mail.ParseAddress(email)
	if err != nil {
		return "", ErrInvalidEmail
	}
	if address.Name != "" || address.Address != email {
		return "", ErrInvalidEmail
	}
	local, domain, found := strings.Cut(email, "@")
	if !found || len(local) > 64 {
		return "", ErrInvalidEmail
	}
	for label := range strings.SplitSeq(domain, ".") {
		if label == "" || len(label) > 63 {
			return "", ErrInvalidEmail
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", ErrInvalidEmail
		}
		for _, character := range label {
			isLetter := character >= 'a' && character <= 'z'
			isDigit := character >= '0' && character <= '9'
			if !isLetter && !isDigit && character != '-' {
				return "", ErrInvalidEmail
			}
		}
	}
	return email, nil
}
