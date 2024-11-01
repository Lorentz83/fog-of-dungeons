package server

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/lorentz83/fogofdungeons/metric"
)

var httpRequests = metric.NewInt("/server/http_requests")

// Logger logs http requests.
type Logger struct {
	H http.Handler
}

// ServeHTTP implements http.Handler.
func (l *Logger) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("%v %v %v [%v]", r.Method, r.URL, r.RemoteAddr, r.Header.Get("X-Forwarded-For"))
	httpRequests.Add(1)
	l.H.ServeHTTP(w, r)
}

// NoCache sends the `Cache-Control: no-cache` header to each request.
type NoCache struct {
	H http.Handler
}

// ServeHTTP implements http.Handler.
func (c *NoCache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Cache-Control", "no-cache")
	c.H.ServeHTTP(w, r)
}

// NewCache wraps the http handler to send a max age public cache for each request.
func NewCache(h http.Handler, maxAge time.Duration) *Cache {
	if maxAge < 0 {
		maxAge = 0
	}
	return &Cache{
		h: h,
		// This is not really the last modification time, but we don't know the built time.
		lastModified: time.Now().In(time.FixedZone("GMT", 0)).Format(time.RFC1123),
		cacheControl: fmt.Sprintf("max-age=%.0f, public", maxAge.Seconds()),
	}
}

// Cache returns the cache header for each request.
type Cache struct {
	h            http.Handler
	lastModified string
	cacheControl string
}

// ServeHTTP implements http.Handler.
func (c *Cache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// TODO implement must-revalidate and If-Modified-Since?
	w.Header().Add("Cache-Control", c.cacheControl)
	w.Header().Add("Last-Modified", c.lastModified)
	c.h.ServeHTTP(w, r)
}

// IndexFile specifies the index file to be used for the / request.
type IndexFile struct {
	H     http.Handler
	Index string
}

// ServeHTTP implements http.Handler.
func (i *IndexFile) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "" || r.URL.Path == "/" {
		r.URL.Path = i.Index
	}
	i.H.ServeHTTP(w, r)
}
