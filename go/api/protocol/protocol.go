// Package protocol contains the messages sent between server and clients.
//
// 1. The player must connect to `player` handler using a webRTC connection.
// 2. The player must send a JoinRoom message.
// 3. The server answers with a WelcomePlayer message.
// 4. Negotiation messages are forwarded from player to master, and vice versa, as they arrive.
//
// 1. The master must connect to `master` handler using a webRTC connection.
// 2. The master must send ControlRoom message.
// 3. The server answers with a WelcomeMaster message.
// 4. The server sends a NewPlayer message for each new player connection.
// 5. Negotiation messages are forwarded between master and players, and vice versa, as they arrive.
//
// At any moment the server can send an Error message for debug purposes.
// The connection is closed if the error is not recoverable.
//
// Welcome* messages may be sent at any time to update the RTCConfiguration.
// RTCConfiguration messages sent to the server are not tied to the specific
// client the welcome message may be addressed.
//
// Check the comments of specific messages for further information.
//
// All the messages received by clients expose a `type` field named after the struct.
//
// NOTE: the test logs of this package can be used to generate a skeleton for the definition
// of these messages in typescript.
package protocol

import "encoding/json"

// sendable is the interface to identifies messages can be sent to clients.
//
// These messages must define a custom json marshaler which exports an extra field
// type with the name of the message type.
type sendable interface {
	json.Marshaler
}

// Negotiation is the negotiation message forwarded between master and player.
//
// PlayerID is the only field which is handled server side.
// Other fields are forwarded verbatim as received by the peer.
type Negotiation struct {
	// PlayerID is used only in messages to and from the master to identify the right player
	// in the multiplexed connection.
	// Players should ignore this field.
	PlayerID string `json:"player_id,omitempty"`
	// Description an optional field used by WebRTC protocol, opaque to the backend.
	Description any `json:"description,omitempty"`
	// Candidate is an optional field required by WebRTC protocol, opaque to the backend.
	Candidate any `json:"candidate,omitempty"`
}

func (n Negotiation) MarshalJSON() ([]byte, error) {
	type T Negotiation
	m := struct {
		T
		Type string `json:"type"`
	}{
		T(n), // Prevents stack overflow.
		"Negotiation",
	}
	return json.Marshal(m)
}

// WelcomeMaster is the first message sent to the master once the connection is established.
type WelcomeMaster struct {
	// Config is the webRTC configuration to use.
	Config RTCConfiguration `json:"config"`
	// Room is the room ID to use.
	// It may be different from the one sent from the master. The master must use the new value.
	Room string `json:"room"`
	// Secret is the secret to use.
	// It may be different from the one sent from the master. The master must use the new value.
	Secret string `json:"secret"`
}

func (w WelcomeMaster) MarshalJSON() ([]byte, error) {
	type T WelcomeMaster
	m := struct {
		T
		Type string `json:"type"`
	}{
		T(w), // Prevents stack overflow.
		"WelcomeMaster",
	}
	return json.Marshal(m)
}

// WelcomePlayer is the first message sent to the player once the connection is established.
type WelcomePlayer struct {
	// Config is the webRTC configuration to use.
	Config RTCConfiguration `json:"config"`
}

func (w WelcomePlayer) MarshalJSON() ([]byte, error) {
	type T WelcomePlayer
	m := struct {
		T
		Type string `json:"type"`
	}{
		T(w), // Prevents stack overflow.
		"WelcomePlayer",
	}
	return json.Marshal(m)
}

// RTCConfiguration is the configuration to send to the clients.
type RTCConfiguration struct {
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

// ControlRoom is the first json message that a master must send once connected.
//
// Can be used to either create a room or to gain control of an existing one.
// All fields are optional.
type ControlRoom struct {
	Room   string `json:"room"`
	Secret string `json:"secret"`
}

// JoinRoom is the first message that a player must send once connected.
type JoinRoom struct {
	Room string `json:"room"`
}

// Error represents an error over the wire.
type Error struct {
	Error string `json:"error"`
}

func (e Error) MarshalJSON() ([]byte, error) {
	type T Error
	m := struct {
		T
		Type string `json:"type"`
	}{
		T(e), // Prevents stack overflow.
		"Error",
	}
	return json.Marshal(m)
}

// NewPlayer is sent to the master to notify there is a new player who wants to connect.
type NewPlayer struct {
	PlayerID string `json:"player_id"`
}

func (n NewPlayer) MarshalJSON() ([]byte, error) {
	type T NewPlayer
	m := struct {
		T
		Type string `json:"type"`
	}{
		T(n), // Prevents stack overflow.
		"NewPlayer",
	}
	return json.Marshal(m)
}
