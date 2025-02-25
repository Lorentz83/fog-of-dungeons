package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/lorentz83/fogofdungeons/api/cache"
	"github.com/lorentz83/fogofdungeons/api/game"
	"github.com/lorentz83/fogofdungeons/api/protocol"
)

// Signaler implements the websocket api for negotiating WebRTC master/players communication.
type Signaler struct {
	basePath string
	place    *game.Place
	config   protocol.RTCConfiguration
}

// NewSignaler returns a new API.
//
// roomExpiration defines for how long the room is reserved once the master leaves.
// timeout is how much time the room is reserved after master leaves, must be greater than 0.
func NewSignaler(basePath string, timeout time.Duration, config protocol.RTCConfiguration) (*Signaler, error) {
	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath = basePath + "/"
	}

	p, err := game.NewPlace(timeout)
	if err != nil {
		return nil, err
	}

	return &Signaler{
		basePath: basePath,
		place:    p,
		config:   config,
	}, nil
}

// ServeHTTP implements http.Handler.
//
// Exposes
//   - /basePath/master?room=id
//   - /basePath/player?room=id
func (s *Signaler) ServeHTTP(rsp http.ResponseWriter, req *http.Request) {
	var handler func(ctx context.Context, c *websocket.Conn)

	switch p := strings.TrimPrefix(req.URL.Path, s.basePath); p {
	case "master":
		handler = s.master
	case "player":
		handler = s.player
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

	c, err := websocket.Accept(rsp, req, nil)
	if err != nil {
		log.Printf("error while accepting socket: %v", err)
		return
	}
	defer c.CloseNow()

	ctx := context.Background() // Library says better not use the request ctx.
	handler(ctx, c)
}

func (s *Signaler) master(ctx context.Context, c *websocket.Conn) {
	var m protocol.ControlRoom
	if err := wsjson.Read(ctx, c, &m); err != nil {
		log.Printf("Error reading first message: %v", err)
		c.Close(websocket.StatusUnsupportedData, "unknown data format")
		return
	}

	welcome := protocol.WelcomeMaster{
		Config: s.config,
		Secret: m.Secret,
		Room:   m.Room,
	}

	// Validation
	if l := len(welcome.Room); l < 4 {
		welcome.Room = cache.GenID()
	}
	if len(m.Secret) < 5 {
		welcome.Secret = cache.GenAuth()
	}

	// Enter the room
	room, err := s.place.ControlRoom(welcome.Room, m.Secret, c)
	if err != nil {
		jError(ctx, c, err.Error())
		c.Close(websocket.StatusUnsupportedData, "Unauthorized")
		return
	}
	defer room.Leave()

	// TODO here there is a race condition: the master may receive a player connection before
	// receiving the configuration.
	if err := wsjson.Write(ctx, c, welcome); err != nil {
		log.Printf("cannot send config to master: %v", err)
		c.CloseNow()
	}

	for {
		var m protocol.Negotiation
		if err := wsjson.Read(ctx, c, &m); err != nil {
			// This is a connection dropped or an invalid message.
			// There is no reason to keep the connection open.
			log.Printf("cannot read negotiation message: %v", err)
			return
		}
		log.Printf("master read: %+v", m)
		if err := room.ToPlayer(ctx, m.PlayerID, m); err != nil {
			jError(ctx, c, err.Error())
			continue
		}
	}
}

func (s *Signaler) player(ctx context.Context, c *websocket.Conn) {
	var m protocol.JoinRoom
	if err := wsjson.Read(ctx, c, &m); err != nil {
		log.Printf("Error reading first message: %v", err)
		c.Close(websocket.StatusUnsupportedData, "unknown data format")
		return
	}

	room, err := s.place.PlayInRoom(m.Room, c)
	if err != nil {
		jError(ctx, c, err.Error())
		c.Close(websocket.StatusUnsupportedData, "Not Found")
		return
	}

	defer room.Leave()

	if err := wsjson.Write(ctx, c, protocol.WelcomePlayer{Config: s.config}); err != nil {
		log.Printf("cannot send config to player: %v", err)
		c.CloseNow()
	}

	if err := room.AskJoin(ctx); err != nil {
		jError(ctx, c, err.Error())
		return
	}

	for {
		var m protocol.Negotiation
		if err := wsjson.Read(ctx, c, &m); err != nil {
			// This is a connection dropped or an invalid message.
			// There is no reason to keep the connection open.
			log.Printf("cannot read negotiation message: %v", err)
			return
		}
		log.Printf("player read: %+v", m)

		if err := room.ToMaster(ctx, m); err != nil {
			jError(ctx, c, err.Error())
			continue
		}
	}
}

func jError(ctx context.Context, c *websocket.Conn, msg string) {
	wsjson.Write(ctx, c, protocol.Error{Error: msg})
}
