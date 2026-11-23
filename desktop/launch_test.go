package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartupUsesLegacyDatabase(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("OPP_CONSENT_FILE", "")
	dir := t.TempDir()
	legacy := `{"host":"db.example","port":5433,"database":"opp_tests","user":"operator","password":"postgres-secret"}`
	if err := os.WriteFile(filepath.Join(dir, "pg-config.json"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	input := newStartupInput(strings.NewReader(strings.Repeat("\n", 5)), &output)
	c, err := input.configure(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "db.example" || c.port != 5433 || c.database != "opp_tests" ||
		c.user != "operator" || c.password != "postgres-secret" {
		t.Fatal("startup configuration did not retain the provided defaults")
	}
	if strings.Contains(output.String(), c.password) {
		t.Fatal("password was printed with the defaults")
	}
}

func TestStartupWithNoLegacyFile(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("OPP_CONSENT_FILE", "")
	dir := t.TempDir()
	var output bytes.Buffer
	input := newStartupInput(strings.NewReader("\n\nskopp\ndb password\n\n"), &output)
	c, err := input.configure(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "localhost" || c.port != 5432 || c.database != "postgres" ||
		c.user != "skopp" || c.password != "db password" {
		t.Fatalf("startup configuration did not match the supplied parameters: %+v", c)
	}
}

func TestStartCommandWithDatabaseParameters(t *testing.T) {
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	// --name is the PostgreSQL login; the tables go to the default database "postgres".
	c, err := parseConfig(strings.Fields("start --ip localhost --port 5432 --name skopp --password skopp"))
	if err != nil {
		t.Fatal(err)
	}
	if c.host != "localhost" || c.port != 5432 || c.database != "postgres" || c.user != "skopp" ||
		c.password != "skopp" {
		t.Fatalf("unexpected configuration: %+v", c)
	}
	c, err = parseConfig(strings.Fields("start --name skopp --password skopp --db opp"))
	if err != nil || c.database != "opp" || c.user != "skopp" {
		t.Fatalf("--db: %+v %v", c, err)
	}
	if _, err := parseConfig(strings.Fields("start --password skopp")); err == nil {
		t.Fatal("start without a login must fail")
	}
}
