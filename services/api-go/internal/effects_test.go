package internal_test

// Below the composition root nothing reads the wall clock, draws randomness or reads the environment:
// each is injected, as a clock function, an id source or a getenv, which is what lets every layer be
// tested without them. Checked over every production file on the syntax tree, so a mention in a comment
// or a string is not a use.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
)

// effects lists, by import path, the functions only the composition root may call, or nil when any use
// of the package is one.
var effects = map[string][]string{
	"time":         {"Now", "Since", "Until"},
	"os":           {"Getenv", "LookupEnv", "Environ", "ExpandEnv"},
	"math/rand":    nil,
	"math/rand/v2": nil,
	"crypto/rand":  nil,
}

// compositionRoot is the package under internal/ that chooses the clock, the id source and the
// environment for everything else; cmd/ is outside internal/ and is not walked.
const compositionRoot = "app"

// effectsIn reports each effect a file causes, found by the package's import path, so a renamed
// import is found too.
func effectsIn(name string, src any) ([]string, error) {
	fset := token.NewFileSet()

	file, err := parser.ParseFile(fset, name, src, 0)
	if err != nil {
		return nil, err
	}

	local := map[string]string{}

	var found []string

	for _, spec := range file.Imports {
		path, _ := strconv.Unquote(spec.Path.Value)

		funcs, listed := effects[path]
		if !listed {
			continue
		}

		if funcs == nil {
			found = append(found, fset.Position(spec.Pos()).String()+" imports "+path)

			continue
		}

		alias := filepath.Base(path)
		if spec.Name != nil {
			alias = spec.Name.Name
		}

		local[alias] = path
	}

	ast.Inspect(file, func(node ast.Node) bool {
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}

		pkg, ok := selector.X.(*ast.Ident)
		if !ok {
			return true
		}

		if path, imported := local[pkg.Name]; imported && slices.Contains(effects[path], selector.Sel.Name) {
			found = append(found, fset.Position(selector.Pos()).String()+" calls "+path+"."+selector.Sel.Name)
		}

		return true
	})

	return found, nil
}

func TestOnlyTheCompositionRootReadsTheClockRandomnessOrTheEnvironment(t *testing.T) {
	t.Parallel()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}

	checked := 0

	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == compositionRoot {
			continue
		}

		for _, file := range productionFiles(t, entry.Name()) {
			found, err := effectsIn(file, nil)
			if err != nil {
				t.Fatal(err)
			}

			checked++

			for _, effect := range found {
				t.Errorf("%s; below the composition root (internal/%s) it is injected", effect, compositionRoot)
			}
		}
	}

	if checked == 0 {
		t.Fatal("no production file was checked, so the rule would pass without checking anything")
	}
}

// The rule must be able to fail. Without this, a broken matcher passes as quietly as clean code.
func TestEffectsInFindsEachPlantedEffect(t *testing.T) {
	t.Parallel()

	planted := map[string]int{
		"package p\nimport \"time\"\nvar at = time.Now()\n":                             1,
		"package p\nimport clock \"time\"\nvar d = clock.Since(clock.Time{})\n":         1,
		"package p\nimport \"os\"\nvar port = os.Getenv(\"PORT\")\n":                    1,
		"package p\nimport \"crypto/rand\"\nvar id = rand.Text()\n":                     1,
		"package p\nimport \"math/rand/v2\"\nvar n = rand.IntN(3)\n":                    1,
		"package p\nimport \"time\"\n// time.Now() in a comment\nvar d time.Duration\n": 0,
		"package p\nimport \"os\"\nvar s = \"os.Getenv\"\nvar _ = os.ErrNotExist\n":     0,
	}

	for src, want := range planted {
		found, err := effectsIn("planted.go", src)
		if err != nil {
			t.Fatal(err)
		}

		if len(found) != want {
			t.Errorf("effectsIn(%q) = %v, want %d effect(s)", src, found, want)
		}
	}
}
