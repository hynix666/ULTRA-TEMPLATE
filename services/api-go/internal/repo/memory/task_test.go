package memory_test

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"

	"github.com/hynix666/ultra-template/services/api-go/internal/entity"
	"github.com/hynix666/ultra-template/services/api-go/internal/repo/memory"
	"github.com/hynix666/ultra-template/services/api-go/internal/usecase"
)

// The compiler checks the port is satisfied; a failing build is the test.
var _ usecase.TaskRepository = (*memory.TaskRepository)(nil)

func TestSaveReplacesAndKeepsInsertionOrder(t *testing.T) {
	t.Parallel()

	repo := memory.NewTaskRepository()
	ctx := context.Background()

	for _, task := range []entity.Task{{ID: "a", Title: "first"}, {ID: "b", Title: "second"}, {ID: "a", Title: "first, renamed"}} {
		if err := repo.Save(ctx, task); err != nil {
			t.Fatal(err)
		}
	}

	tasks, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if len(tasks) != 2 || tasks[0].Title != "first, renamed" || tasks[1].ID != "b" {
		t.Fatalf("tasks = %+v", tasks)
	}
}

func TestGetOfAMissingTaskIsNotFound(t *testing.T) {
	t.Parallel()

	if _, err := memory.NewTaskRepository().Get(context.Background(), "nope"); !errors.Is(err, entity.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

// Run with -race, as CI does, to make this test meaningful.
func TestConcurrentSaves(t *testing.T) {
	t.Parallel()

	repo := memory.NewTaskRepository()
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			_ = repo.Save(ctx, entity.Task{ID: strconv.Itoa(i)})
			_, _ = repo.List(ctx)
		})
	}

	wg.Wait()

	if tasks, _ := repo.List(ctx); len(tasks) != 50 {
		t.Fatalf("len = %d, want 50", len(tasks))
	}
}
