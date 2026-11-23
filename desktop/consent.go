package main

import "strings"

// consentText is the built-in consent to personal data processing shown to students.
// It is based on the consent form of JSC SEZ "Alabuga" (alabuga.ru, 02.06.2025),
// adapted to the data the test actually collects.
func consentText() string {
	body, err := files.ReadFile("consent.txt")
	if err != nil {
		panic(err)
	}
	return strings.TrimSpace(string(body))
}
