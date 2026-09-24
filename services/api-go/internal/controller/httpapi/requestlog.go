package httpapi

import (
	"log/slog"
	"net/http"
	"regexp"
	"time"
)

// RequestIDHeader carries a request's id: echoed when the caller sent a usable one, generated when not.
const RequestIDHeader = "X-Request-Id"

// requestIDPattern bounds what is echoed. An id is copied into a response header and a log line, so
// anything longer, or holding characters a log reader or a header could misread, is replaced.
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// WithRequestLog gives every response an X-Request-Id and writes one log line per request, the same
// line in every task service. The clock and the id source are injected, as everywhere below the
// composition root.
func WithRequestLog(next http.Handler, log *slog.Logger, now func() time.Time, newID func() string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := now()

		id := r.Header.Get(RequestIDHeader)
		if !requestIDPattern.MatchString(id) {
			id = newID()
		}

		w.Header().Set(RequestIDHeader, id)

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)

		log.InfoContext(r.Context(), "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"durationMs", float64(now().Sub(start).Microseconds())/1000,
			"requestId", id,
		)
	})
}

// statusRecorder remembers the status a handler wrote, which http.ResponseWriter does not expose.
type statusRecorder struct {
	http.ResponseWriter

	status  int
	written bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if !s.written {
		s.status = status
		s.written = true
	}

	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(body []byte) (int, error) {
	s.written = true

	return s.ResponseWriter.Write(body)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}
