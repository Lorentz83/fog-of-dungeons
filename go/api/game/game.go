package game

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// NegotiationMessage is the negotiation message forwarded between master and player.
type NegotiationMessage struct {
	// PlayerID is used only in messages to and from the master to identify the right player
	// in the multiplexed connection.
	PlayerID string `json:"player_id,omitempty"`

	// Description is required by WebRTC protocol, opaque to the backend.
	Description any `json:"description,omitempty"`
	// Candidate is required by WebRTC protocol, opaque to the backend.
	Candidate any `json:"candidate,omitempty"`
}

// Place is a collection of Rooms.
type Place struct {
	m       sync.RWMutex
	rooms   map[string]*room
	timeout time.Duration
}

// NewPlace returns a new Place.
func NewPlace(timeout time.Duration) (*Place, error) {
	if timeout <= 0 {
		return nil, errors.New("timeout must be greater than zero")
	}

	return &Place{
		rooms:   map[string]*room{},
		timeout: timeout,
	}, nil
}

// ControlRoom takes ownership of a room if it exists and the secret matches.
//
// If the room doesn't exist it is created.
//
// The code MUST use the context derived from the player seat and cancel it when the connection is closed.
func (p *Place) ControlRoom(id, secret string, masterConn *websocket.Conn) (*MasterSeat, error) {
	p.m.Lock()
	defer p.m.Unlock()

	r, ok := p.rooms[id]
	if !ok {
		r = &room{
			id:           id,
			masterSecret: secret,
			parent:       p,
			players:      map[string]*PlayerSeat{},
		}
		p.rooms[id] = r
	}
	masterSeat, err := r.assignMaster(secret, masterConn)
	if err != nil {
		return nil, err
	}

	return masterSeat, nil
}

// PlayInRoom allows a player entering in an existing room.
//
// The code MUST use the context derived from the player seat and cancel it when the connection is closed.
func (p *Place) PlayInRoom(id string, c *websocket.Conn) (*PlayerSeat, error) {
	p.m.RLock()
	defer p.m.RUnlock()

	r, ok := p.rooms[id]
	if !ok {
		return nil, errors.New("not found")
	}

	return r.addPlayer(c), nil
}

// DeleteRoom deletes the room and invalidates all its connections.
func (p *Place) DeleteRoom(id string) {
	p.m.Lock()
	defer p.m.Unlock()

	r, ok := p.rooms[id]
	if !ok {
		return
	}

	delete(p.rooms, id)
	r.delete()
}

// Place end

// room is the internal representation of a game room.
//
// It allows players to connect to the master's game.
type room struct {
	// m protects all the fields.
	// Player and Master Seat have direct access to these fields.
	m sync.RWMutex

	deleteOn *time.Timer

	parent       *Place
	id           string
	masterSecret string

	master       *MasterSeat
	players      map[string]*PlayerSeat
	nextPlayerID int
}

func (r *room) addPlayer(c *websocket.Conn) *PlayerSeat {
	r.m.Lock()
	defer r.m.Unlock()

	r.nextPlayerID++
	id := fmt.Sprintf("p%03d", r.nextPlayerID) // A string to avoid conversion issues in JS.

	s := &PlayerSeat{
		id:   id,
		room: r,
		conn: c,
	}
	r.players[id] = s

	return s
}

// assignMaster replaces the current master (if present) with the new one only if the secret matches the room.
func (r *room) assignMaster(secret string, c *websocket.Conn) (*MasterSeat, error) {
	r.m.Lock()
	defer r.m.Unlock()

	if r.masterSecret != secret {
		return nil, errors.New("unauthorized")
	}

	if r.deleteOn != nil {
		r.deleteOn.Stop()
		r.deleteOn = nil
	}

	r.master.invalidate()
	r.master = &MasterSeat{room: r, conn: c}

	return r.master, nil
}

// delete invalidates the current room, this object shouldn't be reused.
func (r *room) delete() {
	r.m.Lock()
	defer r.m.Unlock()

	for _, p := range r.players {
		p.invalidate()
	}
	r.players = nil
	r.master.invalidate()
	r.master = nil
}

func (r *room) Player(id string) *PlayerSeat {
	r.m.Lock()
	r.m.Unlock()
	return r.players[id]
}

func (r *room) dropPlayer(p *PlayerSeat) {
	r.m.Lock()
	r.m.Unlock()
	delete(r.players, p.id)
}

func (r *room) Master() *MasterSeat {
	r.m.Lock()
	r.m.Unlock()
	return r.master
}

func (r *room) dropMaster(m *MasterSeat) {
	r.m.Lock()
	r.m.Unlock()

	if r.master == m {
		r.master = nil
		id := r.id
		r.deleteOn = time.AfterFunc(r.parent.timeout, func() {
			r.parent.DeleteRoom(id)
		})
	}
}

// Room end

// PlayerSeat represents a player in a room.
type PlayerSeat struct {
	// m protects all the fields.
	m sync.RWMutex

	id   string
	room *room
	conn *websocket.Conn
}

// AskJoin sends a join request to the master.
func (s *PlayerSeat) AskJoin(ctx context.Context) error {
	please := map[string]string{
		"new_player": s.id,
	}

	return s.room.Master().toMaster(ctx, please)
}

// ToMaster sends a json message to the master.
func (s *PlayerSeat) ToMaster(ctx context.Context, message NegotiationMessage) error {
	message.PlayerID = s.id
	return s.room.Master().toMaster(ctx, message)
}

func (s *PlayerSeat) toPlayer(ctx context.Context, message NegotiationMessage) error {
	if s == nil {
		return fmt.Errorf("unknown player")
	}

	s.m.Lock()
	c := s.conn
	s.m.Unlock()

	return wsjson.Write(ctx, c, message)
}

// Leave invalidates the connection and removes the player from the room.
func (s *PlayerSeat) Leave() {
	s.m.Lock()
	defer s.m.Unlock()

	s.invalidate()

	s.room.dropPlayer(s)
	log.Printf("player %q left", s.id)
}

func (s *PlayerSeat) invalidate() {
	s.conn.CloseNow()
}

// MasterSeat represents the master in a room.
type MasterSeat struct {
	// m protects all the following fields.
	m    sync.RWMutex
	room *room
	conn *websocket.Conn
}

// ToPlayer sends a json message to the master.
func (s *MasterSeat) ToPlayer(ctx context.Context, playerID string, message NegotiationMessage) error {
	message.PlayerID = "" // The player shouldn't care about their ID.
	return s.room.Player(playerID).toPlayer(ctx, message)
}

func (s *MasterSeat) toMaster(ctx context.Context, message any) error {
	if s == nil {
		return errors.New("master disconnected")
	}

	s.m.Lock()
	c := s.conn
	s.m.Unlock()

	return wsjson.Write(ctx, c, message)
}

// Leave invalidates the connection and removes the master from the room.
func (s *MasterSeat) Leave() {
	s.m.Lock()
	defer s.m.Unlock()

	s.invalidate()

	s.room.dropMaster(s)

	log.Printf("master left")
}

func (s *MasterSeat) invalidate() {
	if s == nil {
		return
	}
	s.conn.CloseNow()
}
