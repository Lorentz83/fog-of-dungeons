package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/lorentz83/fogofdungeons/api/cache"
	"github.com/lorentz83/fogofdungeons/metric"
)

const (
	// Maximum size in bytes of a single message on the wire.
	// 5MB "should be enough for everyone".
	readLimit = 5000000
)

var (
	connectedMasters = metric.NewInt("/api/connecter_masters")
	connectedPlayers = metric.NewInt("/api/connected_players")
	totalPlayers     = metric.NewInt("/api/total_players")
	totalMasters     = metric.NewInt("/api/total_masters")
)

// Statistics contains usage statistics.
type Statistics struct {
	GeneratedIDs int
	StoredRooms  int

	ConnectedMasters int
	ConnectedPlayers int
	TotalMasters     int
	TotalPlayers     int
}

// API implements the websocket api for master/players communication.
type API struct {
	basePath string
	cache    *cache.Dispatcher
}

// NewAPI returns a new API.
func NewAPI(basePath string, cacheExpiration time.Duration, playerMessageQueue int) (*API, error) {
	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath = basePath + "/"
	}

	d, err := cache.NewDispatcher(cacheExpiration, playerMessageQueue)
	if err != nil {
		return nil, err
	}
	return &API{
		basePath: basePath,
		cache:    d,
	}, nil
}

// ServeHTTP implements http.Handler.
func (a *API) ServeHTTP(rsp http.ResponseWriter, req *http.Request) {
	var handler func(rsp http.ResponseWriter, req *http.Request)

	// TODO recover from panic here

	switch p := strings.TrimPrefix(req.URL.Path, a.basePath); p {
	case "master":
		handler = a.master
	case "player":
		handler = a.player
	default:
		rsp.WriteHeader(http.StatusNotFound)
		fmt.Fprint(rsp, "Not Found")
		return
	}

	if req.Method != http.MethodGet {
		rsp.WriteHeader(http.StatusMethodNotAllowed)
		fmt.Fprint(rsp, "Method Not Allowed")
		return
	}

	handler(rsp, req)
}

func (a *API) master(rsp http.ResponseWriter, req *http.Request) {
	var (
		id   = req.URL.Query().Get("id")
		auth = req.URL.Query().Get("auth")
	)

	c, err := websocket.Accept(rsp, req, nil)
	if err != nil {
		log.Printf("error while accepting socket: %v", err)
		return
	}
	defer c.CloseNow()

	totalMasters.Add(1)
	connectedMasters.Add(1)
	defer connectedMasters.Add(-1)

	c.SetReadLimit(readLimit)
	ctx := context.Background() // Library says better not use the request ctx

	if (id == "" && auth != "") || (id != "" && auth == "") {
		wsjson.Write(ctx, c, map[string]string{"error": "id and auth must be either both missing or present"})
		c.Close(websocket.StatusGoingAway, "id and auth must be either both missing or present")
		return
	}

	p, err := a.cache.NewPusher(id, auth)
	if err != nil {
		log.Printf("cannot create pusher for %q %q: %v", id, auth, err)
		wsjson.Write(ctx, c, map[string]string{"error": "unauthorized"})
		c.Close(websocket.StatusGoingAway, "unauthorized")
		return
	}
	defer p.Close()

	// send back auth
	log.Printf("master %q connected with auth %q", p.ID, p.Auth)
	if err := wsjson.Write(ctx, c, map[string]string{"id": p.ID, "auth": p.Auth}); err != nil {
		log.Printf("error while sending message to master: %v", err)
		return
	}

	// event loop
	for {
		// TODO add timeout
		// TODO pusher should somehow returns a context which expires
		// when the room is deleted. This way we can drop connection after
		// the timeout.
		_, data, err := c.Read(ctx) // todo check type
		if err != nil {
			log.Printf("cannot read master %q json: %v", p.ID, err)
			c.Close(websocket.StatusUnsupportedData, "unknown data format")
			return
		}
		log.Printf("master %q sent: %v bytes", p.ID, len(data))
		m := &cache.Message{}
		if err := json.Unmarshal(data, m); err != nil {
			log.Printf("cannot unmarshal master %q json: %v", p.ID, err)
			c.Close(websocket.StatusUnsupportedData, "unknown data format")
			return
		}
		if err := p.Push(ctx, m); err != nil {
			log.Printf("error while pushing master's message: %v", err)
			c.Close(websocket.StatusInternalError, "cannot connect to clients")
			return
		}
	}
}

func (a *API) player(rsp http.ResponseWriter, req *http.Request) {
	var id = req.URL.Query().Get("id")

	c, err := websocket.Accept(rsp, req, nil)
	if err != nil {
		log.Printf("error while accepting player's socket: %v", err)
		return
	}
	defer c.CloseNow()

	totalPlayers.Add(1)
	connectedPlayers.Add(1)
	defer connectedPlayers.Add(-1)

	ctx := c.CloseRead(context.Background()) // Library says better not use the request ctx

	log.Printf("client connected for %q", id)

	p, lastMsgs, err := a.cache.NewPuller(id)
	if err != nil {
		log.Printf("cannot create puller: %v", err)
		wsjson.Write(ctx, c, map[string]string{"error": "not found"})
		c.Close(websocket.StatusGoingAway, "not found")
		return
	}
	defer p.Close()

	for _, msg := range lastMsgs {
		if err := wsjson.Write(ctx, c, msg); err != nil {
			log.Printf("error while sending data to player: %v", err)
			return
		}
	}

	for {
		// TODO add timeout?
		// Since we got the context from CloseRead, it expires if the connection drops.
		msg, err := p.Pull(ctx)
		if err != nil {
			log.Printf("error while pulling messages: %v", err)
			return
		}

		if err := wsjson.Write(ctx, c, msg); err != nil {
			log.Printf("error while writing to player: %v", err)
			return
		}
	}
}
