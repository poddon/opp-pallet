package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartupUsesLegacyDatabaseAndConsent(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("OPP_ADMIN_PASSWORD", "administrator-secret")
	t.Setenv("OPP_CONSENT_FILE", "")
	dir := t.TempDir()
	legacy := `{"host":"db.example","port":5433,"database":"opp_tests","user":"operator","password":"postgres-secret"}`
	if err := os.WriteFile(filepath.Join(dir, "pg-config.json"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	consent := filepath.Join(dir, "consent.txt")
	if err := os.WriteFile(consent, []byte("Текст согласия"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	input := newStartupInput(strings.NewReader(strings.Repeat("\n", 7)), &output)
	c, err := input.configure(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "db.example" || c.port != 5433 || c.database != "opp_tests" ||
		c.user != "operator" || c.password != "postgres-secret" ||
		c.adminPassword != "administrator-secret" || c.consentFile != consent {
		t.Fatal("startup configuration did not retain the provided defaults")
	}
	if strings.Contains(output.String(), c.password) || strings.Contains(output.String(), c.adminPassword) {
		t.Fatal("password was printed with the defaults")
	}
}

func TestStartupWithNoLegacyFile(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("OPP_ADMIN_PASSWORD", "")
	t.Setenv("OPP_CONSENT_FILE", "")
	dir := t.TempDir()
	var output bytes.Buffer
	input := newStartupInput(strings.NewReader("\n\nopp_tests\npostgres\ndb password\nadmin password\n\n"), &output)
	c, err := input.configure(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "localhost" || c.port != 5432 || c.database != "opp_tests" ||
		c.user != "postgres" || c.password != "db password" ||
		c.adminPassword != "admin password" || c.consentFile != "" {
		t.Fatal("startup configuration did not match the supplied parameters")
	}
}

func TestStartCommandWithoutSeparateAdminPassword(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("OPP_ADMIN_PASSWORD", "")
	c, err := parseConfig(strings.Fields("start --ip localhost --port 5432 --name maxbot --password maxbotmaxbot"))
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "localhost" || c.port != 5432 || c.database != "maxbot" || c.user != "maxbot" ||
		c.password != "maxbotmaxbot" || c.adminPassword != "maxbotmaxbot" || !c.adminUsesDBPassword {
		t.Fatalf("unexpected configuration: %+v", c)
	}
	if _, err := parseConfig(strings.Fields("start --name maxbot")); err == nil {
		t.Fatal("start without any password must fail")
	}
	if _, err := parseConfig(strings.Fields("start --name maxbot --password x --admin-password short")); err == nil {
		t.Fatal("short separate admin password must fail")
	}
}
