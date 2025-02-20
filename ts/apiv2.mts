

// ISignaler is the interface to send and receive messages.
interface ISignaler {
  send(data: any) :void;
  onMessage: (msg: any) => void;
}

// Signaler is the websocket connection to the server used to negotiate webRTC.
export class Signaler {
  private _roomID = "";
  private _role = "";
  private _sPromise: Promise<WebSocket> | null = null;

  // Callback on message received. msg is valid json object.
  onMessage = (msg: any) => {};

  // Callback which is called when the connection changes.
  onConnectionChange = (connected: boolean) => {};

  constructor(roomID: string, role: "master" | "player") {
    this._roomID = roomID;
    this._role = role;
  }
  
  connect(): Promise<WebSocket> {
    if (this._sPromise) {
      return this._sPromise;
    }
    const addr = `./apiv2/${this._role}?room=${encodeURIComponent(
      this._roomID
    )}`;
    const socket = new WebSocket(addr);
    this._sPromise = new Promise((resolve, reject) => {
      socket.addEventListener("open", (ev) => {
        resolve(socket);
        this.onConnectionChange(true);
      });
      socket.addEventListener("error", (ev) => {
        reject(new Error("cannot connect to server"));
      });
      socket.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        this.onMessage(msg);
      });
      socket.addEventListener("close", (ev) => {
        this._sPromise = null;
        this.onConnectionChange(false);
      });
    });
    return this._sPromise;
  }

  async close() {
    if (this._sPromise === null) {
      return;
    }
    const s = await this._sPromise;
    s.close();
    this._sPromise = null;
  }

  // data will be sent as json.
  async send(data: any) {
    const s = await this.connect();
    data = JSON.stringify(data);
    s.send(data);
  }
}

// SignalWrapper is the wrapper around a signaler which sends playerID in each message.
class PlayerSignaler {
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

// Connect to webRTC following the perfect negotiation pattern.
// https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
function connect(config: RTCConfiguration, signaler: ISignaler, polite: boolean): {pc: RTCPeerConnection, dc: RTCDataChannel} {
  console.log('webRTC config', config)
  
  const pc = new RTCPeerConnection(config);
  const dc = pc.createDataChannel("data", {
    negotiated: true, // Both sides call createDataChannel with agreed ID.
    id: 0,
  });

  pc.onicecandidate = ({ candidate }) => signaler.send({ candidate });

  let makingOffer = false;
  pc.onnegotiationneeded = async () => { // This is called as soon as we end.
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      signaler.send({ description: pc.localDescription});
    } catch (err) {
      console.error(err);
    } finally {
      makingOffer = false;
    }
  };

  let ignoreOffer = false;
  signaler.onMessage = async ({ description, candidate, error }) => {
    if (error) {
      console.log("signal error", error);
      return;
    }
    try {
      if (description) {
        const offerCollision =
          description.type === "offer" &&
          (makingOffer || pc.signalingState !== "stable");

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          return;
        }
        console.log('state',  pc.iceConnectionState,'remote desc', description)
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
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
    console.log("oniceconnectionstatechange", pc.iceConnectionState);
    // TODO handle connection drops.
    // if (pc.iceConnectionState === "failed") {
    //   pc.restartIce();
    // }
  };

  return { pc, dc };
}

async function master() {
  const s = new Signaler("aaaaaaaaaaaaaaaa", "master");
  await s.send({ secret: "" });

  const players = new Map<string, {s: PlayerSignaler, c: RTCDataChannel}>();

  const io = new IO();
  io.onRead = (txt) =>{
    const {s, c} = players.get(io.getPeer())!;
    c.send(txt);
  } 
  io.write('master mode')
  let config: RTCConfiguration = {};

  s.onMessage = (msg) => {
    if (msg.config) { // This is the first message with the ice configuration.
      config = msg.config;
      console.log("got config", config)
    } else if ( msg.new_player ) { // TODO implement multiplex
      const sw = new PlayerSignaler(s,  msg.new_player);
      

      io.addPeer(msg.new_player);

      const { pc, dc } = connect(config, sw, /* unpolite master */false);

      players.set(msg.new_player, {s:sw, c:dc});

      dc.onmessage = (e) =>{
        io.write(`${msg.new_player}> ${e.data}`)
      } 
      dc.onopen = () => {
        io.write(`peer ${msg.new_player} connected`)  
      };

    } else {
      const playerID = msg.player_id;
      const {s, c} = players.get(playerID)!;
      s.onMessage(msg);
    }
  }
}

function player() {
  const s = new Signaler("aaaaaaaaaaaaaaaa", "player");

  s.connect();

  const io = new IO();
  io.write('player mode')

  s.onMessage = msg => {
    // The first message is the configuration.
    let config = msg

    // connect will take ownership of the signaler and overwrite the onMessage.
    const { pc, dc } = connect(config, s, /* players must be polite */ true);

    dc.onopen = () => {
      io.write("data channel ready");
    };
    
    dc.onmessage = (e) => io.write(`> ${e.data}`);
    io.onRead = (msg) => dc.send(msg)
  };
}

const mm = document.querySelector("#master") as HTMLButtonElement;
mm.addEventListener("click", () => master());

const pp = document.querySelector("#player") as HTMLButtonElement;
pp.addEventListener("click", () => player());

class IO {
  private _write;
  private _read;
  private _select;

  constructor() {
    this._read = document.getElementById('in') as HTMLInputElement;
    this._write = document.getElementById('out') as HTMLInputElement;
    this._select = document.getElementById('peer') as HTMLSelectElement;

    this._write.value = '';

    this._read.addEventListener("keydown", (e) => {
      const v = this._read.value;
      if ( e.key == 'Enter') {
        this._read.value = '';
        this.onRead(v);
      }
    });
  }

  onRead = (t:string) => {}
  write(text:string) {
    this._write.value = this._write.value + text + '\n';
  }

  addPeer(name:string) {
    var option = document.createElement("option");
    option.text = name;
    this._select.add(option); 
  }

  getPeer() {
    return this._select.value;
  }
}