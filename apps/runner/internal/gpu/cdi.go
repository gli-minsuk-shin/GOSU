package gpu

import (
	"fmt"
	"regexp"
)

// SelectorPattern deliberately excludes the broad nvidia.com/gpu=all selector.
// Runner operators must approve concrete numeric IDs or stable GPU UUIDs so a
// manifest can never expand its device access beyond the configured list.
var SelectorPattern = regexp.MustCompile(`^nvidia\.com/gpu=(?:[0-9]+|GPU-[A-Za-z0-9-]+)$`)

func ValidateSelector(selector string) error {
	if !SelectorPattern.MatchString(selector) {
		return fmt.Errorf("GPU CDI selector %q must name one concrete NVIDIA device", selector)
	}
	return nil
}

func Select(approved []string, count int64) ([]string, error) {
	if count < 0 {
		return nil, fmt.Errorf("GPU count must be nonnegative")
	}
	if count > int64(len(approved)) {
		return nil, fmt.Errorf("GPU count %d exceeds %d approved CDI devices", count, len(approved))
	}
	selected := make([]string, int(count))
	for index := range selected {
		selector := approved[index]
		if err := ValidateSelector(selector); err != nil {
			return nil, err
		}
		selected[index] = selector
	}
	return selected, nil
}
