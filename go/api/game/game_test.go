package game

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestNewRoom_basicConnections(t *testing.T) {
	ctx := context.Background()

	const (
		room   = "room"
		secret = "my secret"
	)

	p, err := NewPlace(time.Second)
	if err != nil {
		t.Fatalf("NewPlace() unexpected error: %v", err)
	}

	masterControl, master := socketPair(t, ctx)
	playerControl, player := socketPair(t, ctx)

	ms, err := p.ControlRoom(room, secret, master)
	if err != nil {
		t.Fatalf("ControlRoom() returned unexpected error: %v", err)
	}

	ps, err := p.PlayInRoom(room, player)
	if err != nil {
		t.Fatalf("PlayInRoom() returned unexpected error: %v", err)
	}

	var playerID string
	t.Run("ToMaster", func(t *testing.T) {
		if err := ps.ToMaster(ctx, NegotiationMessage{Description: "hello"}); err != nil {
			t.Fatalf("ToMaster() unexpected error: %v", err)
		}

		msg := mustReadMessage(t, ctx, masterControl)
		if msg.Description != "hello" || len(msg.PlayerID) == 0 {
			t.Errorf("got message %+v, want 'Description: Hello' and non empty PlayerID", msg)
		}
		playerID = msg.PlayerID
	})

	t.Run("ToPlayer", func(t *testing.T) {
		if err := ms.ToPlayer(ctx, playerID, NegotiationMessage{Candidate: "hello"}); err != nil {
			t.Fatalf("ToPlayer() unexpected error: %v", err)
		}

		msg := mustReadMessage(t, ctx, playerControl)
		if msg.Candidate != "hello" || len(msg.PlayerID) != 0 {
			t.Errorf("got message %+v, want 'Candidate: Hello'", msg)
		}
	})

	t.Run("new master wrong secret", func(t *testing.T) {
		_, master2 := socketPair(t, ctx)

		_, err := p.ControlRoom(room, "not the secret", master2)
		if err == nil {
			t.Fatalf("ControlRoom(wrong secret) want error")
		}

		ps.ToMaster(ctx, NegotiationMessage{})
		mustReadMessage(t, ctx, masterControl) // The message is delivered to the old master.
	})

	t.Run("new master correct secret", func(t *testing.T) {
		newMasterControl, newMaster := socketPair(t, ctx)

		if _, err := p.ControlRoom(room, secret, newMaster); err != nil {
			t.Fatalf("ControlRoom(right secret) unexpected error: %v", err)
		}

		ps.ToMaster(ctx, NegotiationMessage{})
		mustReadMessage(t, ctx, newMasterControl) // The message is delivered to the new master.
	})
}

func TestNewRoom_MultiplePlayers(t *testing.T) {
	ctx := context.Background()

	const room = "room"

	p, err := NewPlace(time.Second)
	if err != nil {
		t.Fatalf("NewPlace() unexpected error: %v", err)
	}

	masterControl, master := socketPair(t, ctx)
	playerControl1, player1 := socketPair(t, ctx)
	playerControl2, player2 := socketPair(t, ctx)

	ms, err := p.ControlRoom(room, "secret", master)
	if err != nil {
		t.Fatalf("ControlRoom() returned unexpected error: %v", err)
	}

	ps1, err := p.PlayInRoom(room, player1)
	if err != nil {
		t.Fatalf("PlayInRoom() returned unexpected error: %v", err)
	}
	ps2, err := p.PlayInRoom(room, player2)
	if err != nil {
		t.Fatalf("PlayInRoom() returned unexpected error: %v", err)
	}

	if err := ps1.ToMaster(ctx, NegotiationMessage{}); err != nil {
		t.Fatalf("ToMaster() unexpected error: %v", err)
	}
	player1ID := mustReadMessage(t, ctx, masterControl).PlayerID

	if err := ps2.ToMaster(ctx, NegotiationMessage{}); err != nil {
		t.Fatalf("ToMaster() unexpected error: %v", err)
	}
	player2ID := mustReadMessage(t, ctx, masterControl).PlayerID

	if player1ID == player2ID {
		t.Errorf("player IDs should be different, got %v", player1ID)
	}

	if err := ms.ToPlayer(ctx, player1ID, NegotiationMessage{Candidate: "c1"}); err != nil {
		t.Fatalf("ToPlayer() unexpected error: %v", err)
	}
	if msg := mustReadMessage(t, ctx, playerControl1); msg.Candidate != "c1" {
		t.Errorf("want message Candidate=C1, got %v", msg)
	}

	if ms.ToPlayer(ctx, player2ID, NegotiationMessage{Candidate: "c2"}); err != nil {
		t.Fatalf("ToPlayer() unexpected error: %v", err)
	}
	if msg := mustReadMessage(t, ctx, playerControl2); msg.Candidate != "c2" {
		t.Errorf("want message Candidate=C2, got %v", msg)
	}
}

func TestRoomTimeout(t *testing.T) {
	ctx := context.Background()

	const (
		room    = "room"
		timeout = time.Second
	)

	p, err := NewPlace(timeout)
	if err != nil {
		t.Fatalf("NewPlace() unexpected error: %v", err)
	}

	_, master := socketPair(t, ctx)
	_, player := socketPair(t, ctx)

	ms, err := p.ControlRoom(room, "secret", master)
	if err != nil {
		t.Fatalf("ControlRoom() returned unexpected error: %v", err)
	}

	ps1, err := p.PlayInRoom(room, player)
	if err != nil {
		t.Fatalf("PlayInRoom() returned unexpected error: %v", err)
	}

	ms.Leave()

	if ps1.room.master != nil {
		t.Error("master should be nil")
	}
	if n := len(ps1.room.players); n != 1 {
		t.Errorf("got %v player, want 1", n)
	}
	if n := len(p.rooms); n != 1 {
		t.Errorf("got %v rooms, want 1", n)
	}

	time.Sleep(timeout + 100*time.Millisecond)

	if n := len(ps1.room.players); n != 0 {
		t.Errorf("got %v player, want 0", n)
	}
	if n := len(p.rooms); n != 0 {
		t.Errorf("got %v rooms, want 0", n)
	}
}

func mustReadMessage(t *testing.T, ctx context.Context, c *websocket.Conn) NegotiationMessage {
	t.Helper()
	var msg NegotiationMessage
	if err := wsjson.Read(ctx, c, &msg); err != nil {
		t.Fatalf("cannot read message: %v", err)
	}
	return msg
}

func socketPair(t *testing.T, ctx context.Context) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	var wg sync.WaitGroup
	var server, client *websocket.Conn

	wg.Add(1)
	var h http.HandlerFunc = func(w http.ResponseWriter, r *http.Request) {
		defer wg.Done()
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Fatalf("cannot accept server socket: %v", err)
		}
		server = c
	}
	s := httptest.NewServer(h)
	t.Cleanup(func() {
		server.CloseNow()
		client.CloseNow()
		s.Close()
	})
	client, _, err := websocket.Dial(ctx, s.URL, nil)
	if err != nil {
		t.Fatalf("cannot create client socket: %v", err)
	}

	wg.Wait()
	return server, client
}
