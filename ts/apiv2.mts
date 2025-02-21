import { PositionedMarker } from './common.mjs';

// Server messages. Each of these has its equivalent in GO.

// NegotiationMessage is the negotiation message forwarded between master and player.
class NegotiationMessage {
  // PlayerID is used only in messages to and from the master to identify the right player
  // in the multiplexed connection.
  player_id?: string;

  // Description is required by WebRTC protocol, opaque to the backend.
  description?: any;
  // Candidate is required by WebRTC protocol, opaque to the backend.
  candidate?: any;
}

// WelcomeMaster is the first message sent to the master once the connection is established.
interface WelcomeMaster {
  // Config is the webRTC configuration to use.
  config: RTCConfiguration;
  // Room is the room ID to use.
  // It may be different from the one sent from the master. The must must use the new one.
  room: string;
  // Secret is the secret to use.
  // It may be different from the one sent from the master. The must must use the new one.
  secret: string;
}

interface WelcomePlayer extends RTCConfiguration { }

// ControlRoom is the first json message that a master is supposed to send
// once connected.
//
// Can be used to either create a room or jon to an existing one.
class ControlRoom {
  secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }
}

interface Error {
  error: string;
}

// END shared messages

type AnyServerMessage = NegotiationMessage | WelcomeMaster | WelcomePlayer | Error | any;

function makeURL(roomID: string, role: 'master' | 'player') {
  return `./apiv2/${role}?room=${encodeURIComponent(roomID)}`;
}


// ISignaler is the interface to send and receive messages.
interface ISignaler {
  send(data: NegotiationMessage): void;
  onMessage: (msg: AnyServerMessage) => void;
}

// Signaler is the websocket connection to the server used to negotiate webRTC.
class Signaler implements ISignaler {
  private _url: string;
  private _s?: WebSocket;

  // Callback on message received.
  onMessage = (msg: AnyServerMessage) => { };

  // Callback which is called when the connection drops.
  onDisconnection = () => { };

  constructor(url: string) {
    this._url = url;
  }

  connect(): Promise<WebSocket> {
    const socket = new WebSocket(this._url);
    const _sPromise = new Promise<WebSocket>((resolve, reject) => {
      socket.addEventListener('open', (ev) => {
        resolve(socket);
        this._s = socket;
      });
      socket.addEventListener('error', (ev) => {
        reject(new Error('cannot connect to server'));
      });
      socket.addEventListener('message', (ev) => {
        console.log('control pane received', ev.data)
        const msg = JSON.parse(ev.data);
        this.onMessage(msg);
      });
      socket.addEventListener('close', (ev) => {
        this.onDisconnection();
        this._s = undefined;
      });
    });
    return _sPromise;
  }

  async close() {
    if (!this._s) {
      return;
    }
    this._s.close();
  }

  // data will be sent as json.
  async send(data: NegotiationMessage | ControlRoom) {
    if (!this._s) {
      await this.connect();
    }
    const jdata = JSON.stringify(data);
    console.log('sending control plane', jdata);
    this._s!.send(jdata);
  }
}

class ConnectionPair {
  peer: RTCPeerConnection;
  data: RTCDataChannel;
  constructor(peer: RTCPeerConnection, data: RTCDataChannel) {
    this.peer = peer;
    this.data = data;
  }
}

// Connect to webRTC following the perfect negotiation pattern.
// https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
function newWebRTCDataConnection(config: RTCConfiguration, signaler: ISignaler, polite: boolean): ConnectionPair {
  console.log('webRTC config', config, 'politeness', polite);

  const pc = new RTCPeerConnection(config);
  const dc = pc.createDataChannel('data', {
    negotiated: true, // Both sides call createDataChannel with agreed ID.
    id: 0,
  });

  pc.onicecandidate = ({ candidate }) => signaler.send({ candidate });

  let makingOffer = false;
  pc.onnegotiationneeded = async () => {
    // This is called as soon as we end.
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      signaler.send({ description: pc.localDescription });
    } catch (err) {
      console.error(err);
    } finally {
      makingOffer = false;
    }
  };

  let ignoreOffer = false;
  signaler.onMessage = async ({ description, candidate, error }) => {
    if (error) {
      console.log('signal error', error);
      return;
    }
    try {
      if (description) {
        const offerCollision =
          description.type === 'offer' &&
          (makingOffer || pc.signalingState !== 'stable');

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          return;
        }
        console.log('state', pc.iceConnectionState, 'remote desc', description);
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          signaler.send({ description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!ignoreOffer) {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };
  pc.oniceconnectionstatechange = () => {
    console.log('oniceconnectionstatechange', pc.iceConnectionState);
    // TODO handle connection drops.
    // if (pc.iceConnectionState === 'failed') {
    //   pc.restartIce();
    // }
  };

  return new ConnectionPair(pc, dc);
}

export class PlayerPeerConnection {
  private _roomID;
  private _controlConn: Signaler;
  private _master?: ConnectionPair;

  onMap = (data: string) => { };
  onMarkers = (data: PositionedMarker[]) => { };
  onConnectionChange = (room: string | false) => { };

  constructor(roomID: string) {
    this._roomID = roomID;
    this._controlConn = new Signaler(makeURL(roomID, 'player'));
  }

  async connect() {
    this._controlConn.onDisconnection = () => {
      console.log('control connection lost')
    };

    const configP = new Promise<RTCConfiguration>((accept, reject) => {
      // The first message is the configuration
      this._controlConn.onMessage = (msg: any) => {
        if (msg.error) {
          reject(msg.error);
        } else {
          accept(msg);
        }
      };
    })

    await this._controlConn.connect();
    const config = await configP;

    // newWebRTCDataConnection takes ownership of the control connection,
    // overwriting the onMessage callback.
    this._master = newWebRTCDataConnection(config, this._controlConn, true);

    this._master.data.onclose = () => {
      this.onConnectionChange(false);
    };
    this._master.data.onopen = () => {
      this.onConnectionChange(this._roomID);
    }
    this._master.data.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      switch (data.content) {
        case 'merged':
          this.onMap(data.data);
          break;
        case 'markers':
          this.onMarkers(data.data);
          break;
        default:
          console.log('unknown data', data);
      }
    }
  }

  async close() {
    this._controlConn.close();
    this._master?.data.close();
    this._master?.peer.close();
    console.log('connection closed');
  }
}

// All the messages sent are enriched with the player_id field.
// Received messages must be manually filtered at a top level
class IDSignaler implements ISignaler{
  private _signaler: Signaler;
  private _playerID: string;

  onMessage = (msg: any) => {};

  constructor(sender:Signaler, playerID:string){
    this._signaler = sender;
    this._playerID = playerID;
  }

  send(data:any) {
    data.player_id = this._playerID;
    this._signaler.send(data);
  }

  close() {
    this._signaler.close();
  }
}

class PlayerConn extends ConnectionPair {
  signaler: IDSignaler;
  
  constructor(p: ConnectionPair, s: IDSignaler) {
    super(p.peer, p.data);
    this.signaler = s;
  }
}

export class MasterPeerConnection {
  private _roomID = '';
  private _auth = '';
  private _storageKey = '';
  private _players = new Map<string, PlayerConn>()
  private _controlConn: Signaler;
  private _rtcConfig: RTCConfiguration = {};

  // Callback which is called when the connection is established
  // with the roomID or with false if the connection is closed.
  onConnectionChange = (room: string | false) => { };

  constructor(mapID: string) {
    try {
      // TODO this should be a best effort, on auth error should give up.
      this._storageKey = 'map:' + mapID;
      const s = JSON.parse(sessionStorage.getItem(this._storageKey) || '{}');
      this._roomID = s.id || '';
      this._auth = s.auth || '';
      console.log('got auth for ', mapID, s);
    } catch (ex) {
      console.log('cannot get socket parameters', mapID, ex);
    }

    this._controlConn = new Signaler(makeURL(this._roomID, 'master'));
    this._controlConn.onDisconnection = () => {
      console.log('control connection lost');
    };
    this._controlConn.onMessage = (msg) => {
      if ( msg.error ) {
        console.log('error', msg.error);
        // TODO better error handling.
      } else if (msg.config) {
        const welcome = msg as WelcomeMaster;
        this._rtcConfig = welcome.config;
        this._roomID = welcome.room;
        this._auth = welcome.secret;
        sessionStorage.setItem(this._storageKey, JSON.stringify({id: welcome.room, auth: welcome.secret}));
        this.onConnectionChange(this._roomID);
      } else if (msg.new_player) {
        const s = new IDSignaler(this._controlConn, msg.new_player);
        const p = newWebRTCDataConnection(this._rtcConfig, s, /* unpolite */false);
        const c = new PlayerConn(p, s);
        this._players.set(msg.new_player, c);
      } else if (msg.player_id) {
        const s = this._players.get(msg.player_id);
        if (! s ) {
          console.log('unknown player', msg.player_id);
        } else {
          s.signaler.onMessage(msg);
        }
      } else {
        console.log('unknown message', msg); 
      }
    };
    this._controlConn.connect().then(() => {
      console.log('connected to server');
      this._controlConn.send(new ControlRoom(this._auth))
    });
  }

  async close() {
    this._controlConn.close();
    this._players.forEach((conn) => {
      conn.data.close();
      conn.peer.close();
      conn.signaler.close();
    })
    this._players.clear();
  }

  async sendMap(data: string) {
    const jData = JSON.stringify({ content: 'merged', data: data });
    this._players.forEach((conn) => {
      try {
        conn.data.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }

  async sendMarkers(markers: PositionedMarker[]) {
    const jData = JSON.stringify({ content: 'markers', data: markers });
    this._players.forEach((conn) => {
      try {
        conn.data.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }
}
