package main

import (
	"encoding/hex"
	"testing"
)

func TestPBKDF2(t *testing.T) {
	// RFC 7914, section 11: PBKDF2-HMAC-SHA256("passwd", "salt", 1).
	got := hex.EncodeToString(pbkdf2([]byte("passwd"), []byte("salt"), 1))
	if got != "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc" {
		t.Fatal(got)
	}
	if adminLogin("  Цурихин  Дмитрий Сергеевич ") != "цурихин дмитрий сергеевич" || adminLogin("Ёлкин") != "елкин" {
		t.Fatal("login normalisation")
	}
}
