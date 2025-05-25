import { PositionedMarker } from "./common.mjs"


export class MasterSocket {
    private _roomID = '';
    private _auth = '';
    private _sPromise: Promise<WebSocket> | null = null;
    private _storageKey = '';

    // Callback which is called when the connection is established
    // with the roomID or with false if the connection is closed.
    onConnectionChange = (room: string | false) => {};
    
    // Never called, for compatibility with API v2.
    onPlayersChange = (players: number) => {};

    constructor(mapID: string) {
        try {
            // TODO this should be a best effort, on auth error should give up.
            this._storageKey = 'map:' + mapID;
            const s = JSON.parse(sessionStorage.getItem(this._storageKey) || '{}');
            this._roomID = s.id || '';
            this._auth = s.auth || '';
            console.log('got auth for ', mapID, s);
        } catch(ex) {
            console.log('cannot get socket parameters', mapID, ex);
        }
    }
    
    private _checkConnection() {
        if ( this._sPromise ) {
            return this._sPromise;
        }
        const addr = `./api/master?id=${encodeURIComponent(this._roomID)}&auth=${encodeURIComponent(this._auth)}`;
        console.log('connecting to ', addr);
        const socket = new WebSocket(addr);
        this._sPromise = new Promise((resolve, reject) => {
            socket.addEventListener('open', (ev) => {
                console.log('socket opened, waiting for ack message');
            });
            socket.addEventListener('error', (ev) => {
                console.log('socket error', ev);
                reject(new Error('cannot connect to server'));
            });
            socket.addEventListener('message', (ev) => {
                console.log('received', ev.data)
                const msg = JSON.parse(ev.data);
                if ( msg.error ) {
                    console.error('protocol error:', msg)
                    reject(new Error(msg.error));
                    return;
                }
                sessionStorage.setItem(this._storageKey, JSON.stringify(msg));
                this._roomID = msg.id;
                this._auth = msg.auth;
                this.onConnectionChange(msg.id);
                resolve(socket);
            });
            socket.addEventListener('close', (ev) => {
                console.log('socked closed', ev, ev.code);
                this._sPromise = null;
                this.onConnectionChange(false);
            });
        });
        return this._sPromise;
    }

    async close() {
        if ( this._sPromise === null ) {
            return;
        }
        const s = await this._sPromise;
        s.close();
        this._sPromise = null;
        console.log('closing connection');
    }
    
    async sendMap(data: string) {
        const s = await this._checkConnection();
        s.send(JSON.stringify({content: 'merged', data: data}));
    }

    async sendMarkers(markers: PositionedMarker[]) {
        const s = await this._checkConnection();
        s.send(JSON.stringify({content: 'markers', data: markers}));
    }
}

export class PlayerSocket {
    private _roomID = '';
    private _sPromise: Promise<WebSocket> | null = null;

    onMap = (data: string) => {};
    onMarkers = (data: PositionedMarker[]) => {};
    onConnectionChange = (room: string | false) => {};
    
    constructor(roomID: string) {
        this._roomID = roomID;
    }
    
    async connect() {
        if ( this._sPromise ) {
            return await this._sPromise;
        }
        const addr = `./api/player?id=${encodeURIComponent(this._roomID)}`;
        console.log('connecting to ', addr);
        const socket = new WebSocket(addr);
        this._sPromise = new Promise((resolve, reject) => {
            socket.addEventListener('open', (ev) => {
                this.onConnectionChange(this._roomID);
            });
            socket.addEventListener('error', (ev) => {
                console.log('socket error', ev);
                reject(new Error('cannot connect to server'));
                this._sPromise = null
            });
            socket.addEventListener('message', (ev) => {
                console.log('received', ev.data)
                const msg = JSON.parse(ev.data);
                if (msg.error) {
                    reject(new Error(msg.error));
                    socket.close();
                    return;
                }
                resolve(socket);

                switch (msg.content) {
                    case 'markers':
                        this.onMarkers(msg.data as PositionedMarker[]);
                        break;
                    case 'merged':
                        this.onMap(msg.data as string);
                        break;
                    default:
                        console.log('unknown message', msg.content);
                }
            });
            socket.addEventListener('close', (ev) => {
                console.log('socked closed', ev, ev.code);
                this._sPromise = null
                this.onConnectionChange(false);
            });
        });
        return this._sPromise;
    }

    async close() {
        if ( this._sPromise === null ) {
            return;
        }
        const s = await this._sPromise;
        s.close();
        this._sPromise = null;
        console.log('closing connection');
    }
}
