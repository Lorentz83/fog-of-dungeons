import { PositionedMarker } from './common.mjs';

// Server messages. Each of these has its equivalent defined in api/protocol/protocol.go
// Check the go file for documentation

interface Negotiation {
  type?: 'Negotiation';
  player_id?: string;
  description?: any;
  candidate?: any;
}
function AsNegotiation(obj: any): Negotiation | null {
  if ( obj.type !== 'Negotiation') return null;
  return obj as Negotiation;
}

interface WelcomeMaster {
  type?: 'WelcomeMaster';
  config: RTCConfiguration;
  room: string;
  secret: string;
}
function AsWelcomeMaster(obj: any): WelcomeMaster | null {
  if ( obj.type !== 'WelcomeMaster') return null;
  return obj as WelcomeMaster;
}

interface WelcomePlayer {
  type?: 'WelcomePlayer';
  config: RTCConfiguration;
}
function AsWelcomePlayer(obj: any): WelcomePlayer | null {
  if ( obj.type !== 'WelcomePlayer') return null;
  return obj as WelcomePlayer;
}

interface Error {
  type?: 'Error';
  error: string;
}
function AsError(obj: any): Error | null {
  if ( obj.type !== 'Error') return null;
  return obj as Error;
}

interface NewPlayer {
  type?: 'NewPlayer';
  player_id: string;
}
function AsNewPlayer(obj: any): NewPlayer | null {
  if ( obj.type !== 'NewPlayer') return null;
  return obj as NewPlayer;
}

class ControlRoom {
  constructor(public room: string, public secret: string) {}
}

class JoinRoom {
  constructor(public room: string) {}
}


// END shared messages

type AnyServerMessage = NewPlayer | Negotiation | WelcomeMaster | WelcomePlayer | Error;

function makeURL(role: 'master' | 'player') {
  return `./apiv2/${role}`;
}


// ISignaler is the interface to send and receive messages.
interface ISignaler {
  send(data: Negotiation): void;
  onMessage: (msg: AnyServerMessage) => void;
}

// Signaler is the websocket connection to the server used to negotiate webRTC.
class Signaler implements ISignaler {
  private _url: string;
  private _s?: WebSocket;

  // Callback on message received.
  onMessage = (msg: AnyServerMessage) => { };

  // Callback which is called when the connection drops.
  onDisconnection = () => { }; // TODO for the master is important to know when connection is established too.

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
  async send(data: Negotiation | ControlRoom | JoinRoom) {
    if (!this._s) {
      await this.connect();
    }
    const jdata = JSON.stringify(data);
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

  pc.onicecandidate = ({ candidate }) => signaler.send({ candidate: candidate });

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
  signaler.onMessage = async (msg) => {
    const error = AsError(msg);
    if (error) {
      console.log('signal error', error);
      return;
    }
    const n = AsNegotiation(msg);
    if ( n == null) {
      console.log('unsupported message during negotiation', msg);
      return;
    }
    try {
      if (n.description) {
        const offerCollision =
          n.description.type === 'offer' &&
          (makingOffer || pc.signalingState !== 'stable');

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          return;
        }
        console.log('state', pc.iceConnectionState, 'remote desc', n.description);
        await pc.setRemoteDescription(n.description);
        if (n.description.type === 'offer') {
          await pc.setLocalDescription();
          signaler.send({ description: pc.localDescription });
        }
      } else if (n.candidate) {
        try {
          await pc.addIceCandidate(n.candidate);
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
    this._controlConn = new Signaler(makeURL('player'));
  }

  async connect() {
    this._controlConn.onDisconnection = () => {
      console.log('control connection lost')
    };

    const configP = new Promise<RTCConfiguration>((accept, reject) => {
      // The first message is the configuration
      this._controlConn.onMessage = (msg: any) => {
        const err = AsError(msg);
        if ( err ) {
          reject(msg.error);
          return;
        }
        const w = AsWelcomePlayer(msg);
        if ( w ) {
          accept(w.config);
        }
        reject(`unknown message: %{msg}`);
      };
    })

    await this._controlConn.connect();
    this._controlConn.send(new JoinRoom(this._roomID));
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

class PlayerConn {
  signaler: IDSignaler;
  peer?: RTCPeerConnection;
  data?: RTCDataChannel;
  
  constructor(s: IDSignaler) {
    this.signaler = s;
  }

  setWebRTC(p: ConnectionPair) {
    this.peer = p.peer;
    this.data = p.data;
  }
  
  close() {
    this.signaler.close();
    this.peer?.close();
    this.signaler?.close();
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

    this._controlConn = new Signaler(makeURL('master'));
    this._controlConn.onDisconnection = () => {
      console.log('control connection lost');
    };
    this._controlConn.onMessage = (msg) => {
      const error = AsError(msg);
      const welcome = AsWelcomeMaster(msg);
      const newPlayer = AsNewPlayer(msg);
      const negotiation = AsNegotiation(msg);

      if ( error ) {
        console.log('error', error.error);
        // TODO better error handling.
      } else if (welcome) {
        this._rtcConfig = welcome.config;
        this._roomID = welcome.room;
        this._auth = welcome.secret;
        sessionStorage.setItem(this._storageKey, JSON.stringify({id: welcome.room, auth: welcome.secret}));
        this.onConnectionChange(this._roomID);
      } else if (newPlayer) {
        const s = new IDSignaler(this._controlConn, newPlayer.player_id);
        const c = new PlayerConn(s);
        this._players.set(newPlayer.player_id, c); // newWebRTCDataConnection needs to receive messages.
        const p = newWebRTCDataConnection(this._rtcConfig, s, /* unpolite */false);
        c.setWebRTC(p);
      } else if (negotiation) {
        const playerID = negotiation.player_id!;
        const s = this._players.get(playerID);
        if (! s ) {
          console.log('unknown player', playerID);
        } else {
          s.signaler.onMessage(negotiation);
        }
      } else {
        console.log('unknown message', msg); 
      }
    };
    this._controlConn.connect().then(() => {
      console.log('connected to server');
      this._controlConn.send(new ControlRoom(this._roomID, this._auth));
    });
  }

  async close() {
    this._controlConn.close();
    this._players.forEach((conn) => {
      conn.close();
    })
    this._players.clear();
  }

  async sendMap(data: string) {
    const jData = JSON.stringify({ content: 'merged', data: data });
    this._players.forEach((conn) => {
      try {
        conn.data?.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }

  async sendMarkers(markers: PositionedMarker[]) {
    const jData = JSON.stringify({ content: 'markers', data: markers });
    this._players.forEach((conn) => {
      try {
        conn.data?.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }
}
