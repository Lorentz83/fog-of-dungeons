package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"

	"github.com/lorentz83/fogofdungeons/api"
	"github.com/lorentz83/fogofdungeons/api/protocol"
	"github.com/lorentz83/fogofdungeons/metric"
	"github.com/lorentz83/fogofdungeons/server"
)

var (
	//go:embed ui/*
	uiFS embed.FS

	dev         = flag.Bool("dev", false, "enable development mode by serving html files from filesystem")
	listen      = flag.String("listen", "0.0.0.0:9837", "socket to listen for")
	expiration  = flag.Duration("cache_expiration", 30*time.Minute, "after how much time of inactivity a game room is deleted")
	httpCache   = flag.Duration("http_cache", 30*time.Minute, "the HTTP max age for static files. Unused if --dev is set")
	playerQueue = flag.Int("player_queue", 5, "how many messages are stored in a queue before we consider a player unresponsive")

	webRTCConfig = flag.String("webrtc_config", `{"iceServers": [{"urls": "stun:stun.l.google.com:19302"}]}`, "ICE servers to use to negotiate webRTC connection, if disabled peers may connect only on the same network")

	basePath = flag.String("base_path", "/beta", "the base path of the URL to serve. Empty to serve on root")
)

func main() {
	flag.Parse()

	var config protocol.RTCConfiguration
	if err := json.Unmarshal([]byte(*webRTCConfig), &config); err != nil {
		log.Fatalf("invalid --webrtc_config flag: %v", err)
	}
	log.Printf("using webRTC config: %v", config)
	api, err := api.NewSignaler("/api/", *expiration, config)
	if err != nil {
		log.Fatalf("cannot create API: %v", err)
	}

	var staticHandler http.Handler
	if *dev {
		log.Println("DEVELOPER MODE ENABLED")
		staticHandler = &server.NoCache{H: http.FileServer(http.Dir("./ui"))}
	} else {
		uiFS, err := fs.Sub(uiFS, "ui")
		if err != nil {
			panic(err)
		}
		staticHandler = server.NewCache(http.FileServerFS(uiFS), *httpCache)
	}

	m := http.NewServeMux()
	m.Handle(path.Join(*basePath)+"/", http.StripPrefix(*basePath, &server.IndexFile{H: staticHandler, Index: "/master.html"}))
	m.Handle(path.Join(*basePath, "/api/")+"/", http.StripPrefix(*basePath, api))

	s := &server.Logger{H: m}

	hs := http.Server{
		Addr:              *listen,
		Handler:           s,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      20 * time.Second,
	}

	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc,
		syscall.SIGINT,
		syscall.SIGUSR1)
	go func() {
		const sigSec = 2
		var lastSig time.Time
		for s := range sigc {
			if s == syscall.SIGINT {
				n := time.Now()
				if n.Sub(lastSig).Seconds() < sigSec {
					// TODO it would be nice to implement a lame duck mode.
					os.Exit(0)
				}
				lastSig = n
				log.Printf("press ctrl-c twice within %d seconds to exit", sigSec)
			}
			stats := metric.Summary()
			log.Printf("statistics:\n\n%v\n\n", strings.Join(stats, "\n"))
		}
	}()

	log.Printf("listening on http://%s", hs.Addr)
	if err := hs.ListenAndServe(); err != nil {
		log.Fatalf("HTTP Server error: %v", err)
	}
}
