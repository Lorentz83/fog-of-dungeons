// Dispatcher implements a cache dispatch system to deliver messages between players.
package cache

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	crand "crypto/rand"

	"github.com/lorentz83/fogofdungeons/metric"
	"golang.org/x/exp/maps"
)

var (
	generatedIDs = metric.NewInt("/api/cache/generated_rooms_id")
	storedRooms  = metric.NewInt("/api/cache/stored_rooms")
)

// Message represent the wire format of the messages between players.
type Message struct {
	Content string `json:"content"`
	Data    any    `json:"data"`
}

// Puller is an object to receive messages.
type Puller struct {
	ch       chan *Message
	closed   atomic.Bool
	closedCh chan any
}

// Close invalidates the puller and frees the resources.
func (p *Puller) Close() {
	if p.closed.Swap(true) {
		return // already closed
	}
	close(p.closedCh)
loop:
	for {
		// Drain the channel to allow tge garbage collector free memory
		// for _ := range blocks until the channel is closed.
		// This will free up to now, trusting that no one will write to fill it
		// again and waiting for it, and gc will eventually free everything.
		select {
		case <-p.ch:
		default:
			break loop
		}
	}
	// Do not close the channel to prevent panics in case of race conditions.
}

// tryPush is non blocking push, returns if the message was queued.
func (p *Puller) tryPush(msg *Message) bool {
	select {
	case <-p.closedCh:
		return false
	case p.ch <- msg:
		return true
	default:
		// The queue is full, close the channel and disconnect the client.
		p.Close()
		return false
	}
}

// Pull wait and returns the message to deliver.
//
// It can return an error in case the context is expired, or if the
// pull queue got got full because pull is not called frequently
// enough.
func (p *Puller) Pull(ctx context.Context) (*Message, error) {
	if p.closed.Load() {
		return nil, errors.New("connection closed")
	}

	select {
	case msg := <-p.ch:
		return msg, nil
	case <-p.closedCh:
		return nil, errors.New("room deleted")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Pusher allow to push messages to players.
type Pusher struct {
	ID, Auth string
	closed   atomic.Bool
	ch       chan<- *Message
}

// Close invalidates the pusher and frees the resources.
func (p *Pusher) Close() {
	if p != nil {
		p.closed.Store(true)
	}
}

// Push pushes the message to connected players.
func (p *Pusher) Push(ctx context.Context, msg *Message) error {
	if p.closed.Load() {
		return errors.New("connection closed")
	}
	// Note: there is a race condition here, worst case we send an extra message
	// from the old browser tab.
	p.ch <- msg
	return nil
}

type cacheEntry struct {
	mu           sync.Mutex
	id           string
	auth         string
	closed       bool
	lastMessages map[string]*Message
	pusherCh     chan *Message
	pusher       *Pusher
	pullers      []*Puller
}

func (e *cacheEntry) dispatch(msg *Message) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.lastMessages[msg.Content] = msg

	var pp []*Puller
	for _, p := range e.pullers {
		if p.tryPush(msg) {
			pp = append(pp, p)
		}
	}
	log.Printf("message dispatched to %d clients", len(pp))
	e.pullers = pp
}

func (e *cacheEntry) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.closed = true
	e.pusher.Close()
	for _, p := range e.pullers {
		p.Close()
	}
}

// run returns when it is time to delete the entry.
func (e *cacheEntry) run(expiration time.Duration) {
	t := time.NewTimer(expiration)
	defer t.Stop()

	for {
		select {
		case msg := <-e.pusherCh:
			t.Reset(expiration)
			e.dispatch(msg)
		case <-t.C:
			e.Close()
			return
		}
	}
}

func (e *cacheEntry) LastMessages() []*Message {
	e.mu.Lock()
	defer e.mu.Unlock()

	return maps.Values(e.lastMessages)
}

func (e *cacheEntry) NewPuller(queueSize int) (*Puller, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return nil, errors.New("connection closed")
	}

	p := &Puller{
		ch:       make(chan *Message, queueSize),
		closedCh: make(chan any),
	}

	e.pullers = append(e.pullers, p)
	return p, nil
}

func (e *cacheEntry) NewPusher() (*Pusher, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return nil, errors.New("connection closed")
	}

	e.pusher.Close()
	e.pusher = &Pusher{
		ID:   e.id,
		Auth: e.auth,
		ch:   e.pusherCh,
	}
	return e.pusher, nil
}

func newCacheEntry(id, auth string) *cacheEntry {
	e := &cacheEntry{
		id:           id,
		auth:         auth,
		lastMessages: map[string]*Message{},
		pusherCh:     make(chan *Message, 1), // TODO correct size?
	}
	e.NewPusher()
	return e
}

// Dispatcher implements a (mostly) non blocking delivery system for messages between player.
type Dispatcher struct {
	expiration  time.Duration
	pullerQueue int

	mu      sync.Mutex
	entries map[string]*cacheEntry
}

// NewDispatcher returns a new Dispatcher.
//
// expiration defines after how much time a game room is garbage collected.
//
// pullerQueue defines after how many unread messages a puller is
// considered inactive and therefore closed.
func NewDispatcher(expiration time.Duration, pullerQueue int) (*Dispatcher, error) {
	if expiration <= 0 {
		return nil, errors.New("cache expiration must be positive")
	}
	if pullerQueue <= 0 {
		return nil, errors.New("pullerQueue must be positive")
	}
	return &Dispatcher{
		expiration:  expiration,
		pullerQueue: pullerQueue,
		entries:     map[string]*cacheEntry{},
	}, nil
}

// NewPusher returns a object to push messages to players.
//
// id is the ID of the room and auth is a secret to authorize who can push to this room.
//
// A single pusher per ID can exists, in case a new pusher is requested, the old one is closed automatically.
//
// Both ID and auth are optional, if missing they'll be generated.
// If auth is invalid an error is returned.
// If ID is not in cache anymore, a new room with ID and auth is created.
func (d *Dispatcher) NewPusher(id, auth string) (*Pusher, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// If ID then check auth and replace pusher
	if id != "" {
		e, ok := d.entries[id]
		if ok {
			if e.auth != auth {
				return nil, errors.New("unauthorized")
			}
			return e.NewPusher()
		}
		// Last case we have ID but not in memory, just recreate the entry with the given ID and auth.
	} else {
		id = genID()
		auth = genAuth()
	}

	if _, ok := d.entries[id]; ok {
		return nil, errors.New("server overloaded")
	}

	e := newCacheEntry(id, auth)
	storedRooms.Add(1)
	d.entries[id] = e
	go func() {
		e.run(d.expiration)
		d.mu.Lock()
		defer d.mu.Unlock()
		storedRooms.Add(-1)
		delete(d.entries, id)
	}()

	return e.pusher, nil
}

// NewPuller returns a struct to receive messages from the game ID.
//
// A game ID can have as many pullers as required.
// It is important to call Close to free the resources when Puller is not required anymore.
//
// It is delivered also a message per type among the most recently delivered.
func (d *Dispatcher) NewPuller(id string) (*Puller, []*Message, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	e, ok := d.entries[id]
	if !ok {
		return nil, nil, errors.New("not found")
	}

	p, err := e.NewPuller(d.pullerQueue)
	if err != nil {
		return nil, nil, err
	}
	return p, e.LastMessages(), nil
}

var idAlphabet = ([]rune)("23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ")

func genID() string {
	generatedIDs.Add(1)

	var mod = int64(len(idAlphabet))
	var ret []rune
	// TODO here it is hardcoded max 1 game room per second.
	for i := time.Now().Unix(); i > 0; i = i / mod {
		r := idAlphabet[i%mod]
		ret = append(ret, r)
	}
	return string(ret)
}

func genAuth() string {
	b := make([]byte, 25)
	_, err := crand.Read(b)
	if err != nil {
		fmt.Println("error:", err)
	}
	return base64.RawStdEncoding.EncodeToString(b)
}
