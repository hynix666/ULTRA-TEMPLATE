// Package entity is the domain model. It imports nothing from this module and performs no I/O:
// its rules are the ones every transport and every store must agree on. The architecture test in
// internal/architecture_test.go fails the build when that stops being true.
package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Status is where a task is in its lifecycle.
type Status string

// The statuses a task moves through.
const (
	StatusTodo       Status = "todo"
	StatusInProgress Status = "in_progress"
	StatusDone       Status = "done"
)

// statuses lists every status in lifecycle order: ParseStatus accepts these and nothing else.
var statuses = []Status{StatusTodo, StatusInProgress, StatusDone}

// MaxTitleLength bounds a title, counted in characters rather than bytes.
const MaxTitleLength = 200

// Domain errors. Transports map them to their own error shapes; nothing here knows which
// transport is asking. A message that states a rule is built from it, so the two cannot differ.
var (
	ErrEmptyTitle        = errors.New("title must not be empty")
	ErrTitleTooLong      = fmt.Errorf("title must be at most %d characters", MaxTitleLength)
	ErrUnknownStatus     = fmt.Errorf("status must be one of %s", statusNames())
	ErrInvalidTransition = errors.New("status transition not allowed")
	ErrNotFound          = errors.New("task not found")
)

// Task is a unit of work.
type Task struct {
	ID        string
	Title     string
	Status    Status
	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewTask validates title and returns a task in StatusTodo. The caller supplies the ID and the
// time, which keeps this package deterministic.
func NewTask(id, title string, now time.Time) (Task, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Task{}, ErrEmptyTitle
	}

	if utf8.RuneCountInString(title) > MaxTitleLength {
		return Task{}, ErrTitleTooLong
	}

	return Task{ID: id, Title: title, Status: StatusTodo, CreatedAt: now, UpdatedAt: now}, nil
}

// ParseStatus converts external input into a Status.
func ParseStatus(s string) (Status, error) {
	if status := Status(s); slices.Contains(statuses, status) {
		return status, nil
	}

	return "", ErrUnknownStatus
}

func statusNames() string {
	names := make([]string, len(statuses))
	for i, status := range statuses {
		names[i] = string(status)
	}

	return strings.Join(names, ", ")
}

// Transition returns a copy of t moved to next, or ErrInvalidTransition.
func (t Task) Transition(next Status, now time.Time) (Task, error) {
	if !canTransition(t.Status, next) {
		return Task{}, ErrInvalidTransition
	}

	t.Status = next
	t.UpdatedAt = now

	return t, nil
}

// canTransition lists every legal move. Anything absent is refused, including staying put.
func canTransition(from, to Status) bool {
	switch from {
	case StatusTodo:
		return to == StatusInProgress
	case StatusInProgress:
		return to == StatusTodo || to == StatusDone
	default:
		return false
	}
}
