package main

import (
	"strings"
	"testing"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{"PGUSER", "PGPASSWORD", "OPP_ADMIN_PASSWORD", "OPP_CONSENT_FILE"} {
		t.Setenv(name, "")
	}
}

func TestStartWithExternalParametersWithoutAdminPassword(t *testing.T) {
	clearEnv(t)
	c, err := parseConfig([]string{"start", "--ip", "localhost", "--port", "5432", "--name", "maxbot", "--password", "maxbotmaxbot"})
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "localhost" || c.port != 5432 || c.database != "maxbot" || c.user != "maxbot" ||
		c.password != "maxbotmaxbot" || c.adminPassword != "" {
		t.Fatalf("unexpected configuration: %+v", c)
	}
}

func TestShortAdminPasswordIsRejected(t *testing.T) {
	clearEnv(t)
	if _, err := parseConfig([]string{"start", "--name", "maxbot", "--admin-password", "short"}); err == nil {
		t.Fatal("a short administrator password must be rejected")
	}
	if _, err := parseConfig([]string{"start", "--name", "maxbot", "--admin-password", "long-enough-secret"}); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogHasNoGeneralTest(t *testing.T) {
	catalog, err := readCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 4 {
		t.Fatalf("expected four thematic tests, got %d", len(catalog))
	}
	for _, item := range catalog {
		if item.ID == "general" {
			t.Fatal("the combined general test must not exist")
		}
	}
}

func TestGeneratedPassword(t *testing.T) {
	seen := map[string]bool{}
	for range 20 {
		password, err := newPassword()
		if err != nil {
			t.Fatal(err)
		}
		if len(password) != 16 || strings.Trim(password, passwordAlphabet) != "" || seen[password] {
			t.Fatalf("unexpected password %q", password)
		}
		seen[password] = true
	}
}
