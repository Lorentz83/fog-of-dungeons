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

// ISignaler is the interface to send and receive control messages to negotiate webRTC.
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
  onDisconnection = () => { };

  constructor(role: 'master' | 'player') {
    this._url = `./apiv2/${role}`;
  }

  // connects to the server, the promise is resolved when the connection is established.
  connect(): Promise<void> {
    const socket = new WebSocket(this._url);
    const _sPromise = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', (ev) => {
        this._s = socket;
        resolve();
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
  // It is required to call connect() before calling send.
  async send(data: Negotiation | ControlRoom | JoinRoom) {
    if ( !this._s ) {
      throw(new Error('websocket not connected'));
    }
    this._s!.send(JSON.stringify(data));
  }
}


// PeerConnection is a webRTC data connection.
class PeerConnection {
  _peer?: RTCPeerConnection;
  _data?: RTCDataChannel;

  onConnectionChange = (connected: boolean) => {};
  onMessage = (msg: any) => {};

  // Connect to webRTC following the perfect negotiation pattern.
  // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
  // 
  // Config is the initial configuration.
  // signaler is used only to exchange candidates, no other message is handled, server errors are just logged.
  // one peer must be polite, the other must be not polite.
  connect(config: RTCConfiguration, signaler: ISignaler, polite: boolean) {
    console.log('webRTC config', config, 'politeness', polite);

    const pc = new RTCPeerConnection(config);
    const dc = pc.createDataChannel('data', {
      negotiated: true, // Both sides call createDataChannel with agreed ID.
      id: 0,
    });
    dc.onmessage = (ev) => { this.onMessage(ev.data) };

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
          const offerCollision = n.description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');

          ignoreOffer = !polite && offerCollision;
          if (ignoreOffer) {
            return;
          }
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
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState#value
      // new -> checking -> connected -> completed
      // disconnected can be a transient error.
      // pc.restartIce() can be called on failed connection to retry.
      switch( pc.iceConnectionState ) {
        case 'connected':
        case 'completed': // Everything is connected!
          this._peer = pc;
          this._data = dc;
          this.onConnectionChange(true);
          break;
        case 'failed':
          this.onConnectionChange(false);
          break;
        case 'closed':
          this._peer = undefined;
          this._data = undefined;
          this.onConnectionChange(false);
          break;
      }
    };
  }

  close() {
    this._data?.close();
    this._peer?.close();
  }

  send(msg: any) {
    this._data!.send(msg);
  }
}

export class PlayerPeerConnection {
  private _roomID;
  private _controlConn: Signaler;
  private _master?: PeerConnection;

  onMap = (data: string) => { };
  onMarkers = (data: PositionedMarker[]) => { };
  onConnectionChange = (room: string | false) => { };

  constructor(roomID: string) {
    this._roomID = roomID;
    this._controlConn = new Signaler('player');
  }

  async connect() {
    const master = new PeerConnection();

    const configP = new Promise<RTCConfiguration>((accept, reject) => {
      this._controlConn.onDisconnection = () => {
        // TODO should we care of control disconnection as long as p2p is still connected?
        console.log('control connection lost');
        reject('control connection lost');
      };
      // The first message is the configuration
      this._controlConn.onMessage = (msg: any) => {
        const err = AsError(msg);
        const w = AsWelcomePlayer(msg);
        if ( err ) {
          reject(msg.error);
        } else if ( w ) {
          accept(w.config);
        } else {
          reject(`unknown message: %{msg}`);
        }
      };
    })

    await this._controlConn.connect();
    this._controlConn.send(new JoinRoom(this._roomID));
    const config = await configP;

    // newWebRTCDataConnection takes ownership of the control connection,
    // overwriting the onMessage callback.
    master.connect(config, this._controlConn, true);

    master.onConnectionChange = (connected) => {
      if ( connected ) {
        this._master = master;
        this.onConnectionChange(this._roomID);
      } else {
        this.onConnectionChange(false);
      }
    };
    
    master.onMessage = (msg) => {
      console.log('received p2p message', msg);
      const data = JSON.parse(msg);
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
    this._master?.close();
    console.log('connection closed');
  }
}

// All the messages sent are enriched with the player_id field.
// Received messages must be manually filtered at a higher level.
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
}

class PlayerConn {
  signaler: IDSignaler;
  private conn?: PeerConnection
  
  constructor(s: IDSignaler) {
    this.signaler = s;
  }

  setWebRTC(p: PeerConnection) {
    this.conn = p;
  }
  
  close() {
    this.conn?.close();
  }

  send(msg: any) {
    this.conn!.send(msg);
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
  // with the roomID or with false if the control connection is closed.
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

    this._controlConn = new Signaler('master');
    this._controlConn.onDisconnection = () => {
      console.log('control connection lost');
      this.onConnectionChange(false);
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
        console.log('new player connecting', newPlayer.player_id)
        const s = new IDSignaler(this._controlConn, newPlayer.player_id);
        const c = new PlayerConn(s);
        this._players.set(newPlayer.player_id, c); // newWebRTCDataConnection needs to receive messages.
        const p = new PeerConnection()
        p.connect(this._rtcConfig, s, /* unpolite */false);
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
    this._players.forEach((conn, id) => {
      try {
        conn.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }

  async sendMarkers(markers: PositionedMarker[]) {
    const jData = JSON.stringify({ content: 'markers', data: markers });
    this._players.forEach((conn, id) => {
      try {
        conn.send(jData);
      } catch (e) {
        console.log('error sending map to peer', e);
      }
    });
  }
}
