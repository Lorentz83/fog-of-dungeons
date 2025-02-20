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
)

// WelcomeMaster is the first message sent to the master once the connection is established.
type WelcomeMaster struct {
	// Config is the webRTC configuration to use.
	Config WebRTCConfig `json:"config"`
	// Room is the room ID to use.
	// It may be different from the one sent from the master. The must must use the new one.
	Room string `json:"room"`
	// Secret is the secret to use.
	// It may be different from the one sent from the master. The must must use the new one.
	Secret string `json:"secret"`
}

// WebRTCConfig is the configuration to send to the clients.
type WebRTCConfig struct {
	IceServers []IceServer `json:"iceServers,omitempty"`
}

// IceServer represents an ice server to support WebRTC connection.
type IceServer struct {
	// Credential to use when logging into the TURN server.
	Credential string `json:"credential,omitempty"`
	// Username to connect to TURN server.
	Username string `json:"username,omitempty"`
	// URLS is the server URL.
	URL string `json:"urls"`
}

// ControlRoom is the first json message that a master is supposed to send
// once connected.
//
// Can be used to either create a room or jon to an existing one.
type ControlRoom struct {
	Secret string `json:"secret"`
}

// Signaler implements the websocket api for negotiating WebRTC master/players communication.
type Signaler struct {
	basePath string
	place    *game.Place
	config   WebRTCConfig
}

// NewSignaler returns a new API.
//
// roomExpiration defines for how long the room is reserved once the master leaves.
// timeout is how much time the room is reserved after master leaves, must be greater than 0.
func NewSignaler(basePath string, timeout time.Duration, config WebRTCConfig) (*Signaler, error) {
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
	var handler func(ctx context.Context, c *websocket.Conn, roomID string)

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

	roomID := req.URL.Query().Get("room")

	c, err := websocket.Accept(rsp, req, nil)
	if err != nil {
		log.Printf("error while accepting socket: %v", err)
		return
	}
	defer c.CloseNow()

	ctx := context.Background() // Library says better not use the request ctx.
	handler(ctx, c, roomID)
}

func (s *Signaler) master(ctx context.Context, c *websocket.Conn, roomID string) {
	var m ControlRoom
	if err := wsjson.Read(ctx, c, &m); err != nil {
		log.Printf("Error reading first message: %v", err)
		c.Close(websocket.StatusUnsupportedData, "unknown data format")
		return
	}

	welcome := WelcomeMaster{Config: s.config}

	// Validation
	if l := len(roomID); l < 4 {
		welcome.Room = cache.GenID()
	}
	if len(m.Secret) < 5 {
		welcome.Secret = cache.GenAuth()
	}

	// Enter the room
	room, err := s.place.ControlRoom(roomID, m.Secret, c)
	if err != nil {
		jError(ctx, c, err.Error())
		c.Close(websocket.StatusUnsupportedData, "Unauthorized")
		return
	}
	defer room.Leave()

	// TODO here there is a race condition: the master may receive a player connection before
	// receiving hte configuration.
	if err := wsjson.Write(ctx, c, welcome); err != nil {
		log.Printf("cannot send config to master: %v", err)
		c.CloseNow()
	}

	for {
		var m game.NegotiationMessage
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

func (s *Signaler) player(ctx context.Context, c *websocket.Conn, roomID string) {
	room, err := s.place.PlayInRoom(roomID, c)
	if err != nil {
		jError(ctx, c, err.Error())
		c.Close(websocket.StatusUnsupportedData, "Not Found")
		return
	}

	defer room.Leave()

	if err := wsjson.Write(ctx, c, s.config); err != nil {
		log.Printf("cannot send config to player: %v", err)
		c.CloseNow()
	}

	if err := room.AskJoin(ctx); err != nil {
		jError(ctx, c, err.Error())
		return
	}

	for {
		var m game.NegotiationMessage
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
	err := struct {
		Error string `json:"error"`
	}{msg}
	wsjson.Write(ctx, c, err)
}
