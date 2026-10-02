package link

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// NormalizeURL validates an absolute HTTP(S) URL and removes tracking parameters
// and fragments while preserving the path and remaining query parameters.
func NormalizeURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("parse URL: %w", err)
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
	default:
		return "", errors.New("URL must use http or https")
	}

	if parsed.Hostname() == "" {
		return "", errors.New("URL must have a host")
	}

	if _, err := url.ParseQuery(parsed.RawQuery); err != nil {
		return "", fmt.Errorf("parse URL query: %w", err)
	}

	parameters := []string{}
	for parameter := range strings.SplitSeq(parsed.RawQuery, "&") {
		if parameter == "" {
			continue
		}

		key, _, _ := strings.Cut(parameter, "=")
		key, err := url.QueryUnescape(key)
		if err != nil {
			return "", fmt.Errorf("decode URL query key: %w", err)
		}
		if strings.HasPrefix(strings.ToLower(key), "utm_") {
			continue
		}

		parameters = append(parameters, parameter)
	}

	parsed.Scheme = "https"
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Fragment = ""
	parsed.RawFragment = ""
	parsed.RawQuery = strings.Join(parameters, "&")
	parsed.ForceQuery = false

	return parsed.String(), nil
}
