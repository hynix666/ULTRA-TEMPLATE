package repotest_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/hynix666/ultra-template/services/api-go/internal/entity"
	"github.com/hynix666/ultra-template/services/api-go/internal/repo/repotest"
	"github.com/hynix666/ultra-template/services/api-go/internal/usecase"
)

// broken is a store with the mistakes a new adapter makes: it lists newest first, answers a missing
// task with an empty one, and keeps every task in one variable that all its instances share.
type broken struct{}

var shared []entity.Task

func (broken) Save(_ context.Context, task entity.Task) error {
	shared = slices.Insert(shared, 0, task)

	return nil
}

func (broken) Get(_ context.Context, id string) (entity.Task, error) {
	for _, task := range shared {
		if task.ID == id {
			return task, nil
		}
	}

	return entity.Task{}, nil
}

func (broken) List(context.Context) ([]entity.Task, error) { return shared, nil }

// The suite must be able to fail, or a store passes it by passing nothing.
func TestTheSuiteFailsABrokenStore(t *testing.T) {
	problems := strings.Join(repotest.Check(t.Context(), func() usecase.TaskRepository { return broken{} }), "\n")
	for _, want := range []string{"a task never saved is not found", "listed oldest first", "two stores share nothing", "an empty store lists nothing"} {
		if !strings.Contains(problems, want) {
			t.Errorf("the suite did not report %q for a broken store; it reported:\n%s", want, problems)
		}
	}
}
