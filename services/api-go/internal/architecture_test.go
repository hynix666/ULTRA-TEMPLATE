package internal_test

// The dependency rule, enforced over every production file instead of left to review. Each layer
// lists what it must not import: module packages written relative to the module root, and
// standard-library packages. Test files are exempt, because a test may wire real implementations
// together; the rule is about what ships.

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

var forbidden = map[string][]string{
	"entity":     {"internal", "net", "os", "database/sql"},
	"usecase":    {"internal/repo", "internal/controller", "internal/app", "internal/config", "net", "os", "database/sql"},
	"repo":       {"internal/controller", "internal/app", "internal/config"},
	"controller": {"internal/repo", "internal/app", "internal/config", "database/sql"},
}

// unrestricted lists the internal packages the rule deliberately leaves alone: the composition root
// and the configuration it reads. Every other package under internal/ must be a layer above, so a new
// package cannot escape the rule by being new.
var unrestricted = map[string]bool{"app": true, "config": true}

func TestEveryInternalPackageHasARule(t *testing.T) {
	t.Parallel()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}

	for _, entry := range entries {
		if _, layer := forbidden[entry.Name()]; entry.IsDir() && !layer && !unrestricted[entry.Name()] {
			t.Errorf("internal/%s is neither a layer in forbidden nor listed in unrestricted, so no import rule covers it", entry.Name())
		}
	}
}

// violation reports whether layer may not import importPath. A rule matches the package it names
// and everything below it, never a package that merely shares a prefix: "net" forbids net/http,
// not a package called network.
func violation(module, layer, importPath string) bool {
	for _, rule := range forbidden[layer] {
		target := rule
		if rule == "internal" || strings.HasPrefix(rule, "internal/") {
			target = module + "/" + rule
		}

		if importPath == target || strings.HasPrefix(importPath, target+"/") {
			return true
		}
	}

	return false
}

func TestLayersImportOnlyWhatTheyMay(t *testing.T) {
	t.Parallel()

	module := modulePath(t)

	for layer := range forbidden {
		files := productionFiles(t, layer)
		if len(files) == 0 {
			t.Errorf("layer %q has no Go files, so its rule would pass without checking anything", layer)
		}

		for _, file := range files {
			parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatal(err)
			}

			for _, spec := range parsed.Imports {
				importPath, _ := strconv.Unquote(spec.Path.Value)
				if violation(module, layer, importPath) {
					t.Errorf("%s imports %s, which the %s layer must not depend on", file, importPath, layer)
				}
			}
		}
	}
}

// The rule must be able to fail. Without this, a broken matcher passes as quietly as clean code.
func TestViolationDetectsForbiddenImports(t *testing.T) {
	t.Parallel()

	const module = "example.com/svc"

	tests := []struct {
		layer, importPath string
		want              bool
	}{
		{"entity", "net/http", true},
		{"entity", "os", true},
		{"entity", "strings", false},
		{"entity", "network/thing", false},
		{"entity", module + "/internal/usecase", true},
		{"usecase", module + "/internal/entity", false},
		{"usecase", module + "/internal/repo/memory", true},
		{"controller", module + "/internal/app", true},
		{"controller", module + "/internal/usecase", false},
		{"repo", module + "/internal/entity", false},
	}

	for _, tt := range tests {
		if got := violation(module, tt.layer, tt.importPath); got != tt.want {
			t.Errorf("violation(%s imports %s) = %v, want %v", tt.layer, tt.importPath, got, tt.want)
		}
	}
}

func modulePath(t *testing.T) string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("..", "go.mod"))
	if err != nil {
		t.Fatal(err)
	}

	for line := range strings.SplitSeq(string(raw), "\n") {
		if name, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			return strings.TrimSpace(name)
		}
	}

	t.Fatal("go.mod has no module line")

	return ""
}

func productionFiles(t *testing.T, dir string) []string {
	t.Helper()

	var files []string

	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !entry.IsDir() && strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, "_test.go") {
			files = append(files, path)
		}

		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	return files
}
