
const idAlphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const idAlphabetLen = idAlphabet.length;

// keepAwakeCheckbox links a checkbox to the KeepAwake class.
export function keepAwakeCheckbox(checkBox: HTMLInputElement): KeepAwake {
    checkBox.checked = false;
    const keepAwake = new KeepAwake();
    if ( !keepAwake.isSupported ) {
        checkBox.disabled = true;
        return keepAwake;
    }
    keepAwake.onChange = (enabled) => { checkBox.checked = enabled };

    checkBox.addEventListener('change', () => { keepAwake.set(checkBox.checked) });

    return keepAwake;
}

// KeepAwake is a convenience wrapper around the wake lock API.
export class KeepAwake {
    readonly isSupported: boolean;
    onChange = (enabled: boolean) => {};

    private _wakeLock?: WakeLockSentinel;

    constructor() {
        this.isSupported = 'wakeLock' in navigator;
        if ( !this.isSupported ) {
            return;
        }
        document.addEventListener('visibilitychange', () => this._handleVisibilityChange() );
    }
    
    async set(enable: boolean): Promise<void> {
        if ( enable ) {
            return this.enable();
        } else {
            return this.disable();
        }
    }

    // Re acuire wakelock if we go back to this tab.
    private async _handleVisibilityChange() {
        if ( this._wakeLock && document.visibilityState === 'visible' ) {
            this._wakeLock = await navigator.wakeLock.request('screen');
            console.log('re acquiring wake lock');
            this._forceEnable();
        }
    }

    async enable(): Promise<void> {
        if ( this._wakeLock ) {
            console.log('wake lock already enabled');
            return;
        }
        this._forceEnable();
    }

    private async _forceEnable() {
        this._wakeLock = await navigator.wakeLock.request('screen');
        console.log('wake lock acquired');
        this.onChange(true);
        this._wakeLock.addEventListener('release', () => {
            console.log('wake lock released');
            this.onChange(false);
        });
    }

    async disable(): Promise<void> {
        if ( this._wakeLock ) {
            await this._wakeLock.release();
            this._wakeLock = undefined;
        }
    }
}

export function newID():string {
    let ret = '';
    // Here we reverse the bytes of the date, so the last part of the string
    // is the one that looks similar.
    for ( let i = Date.now() ; i > 0; i = Math.floor(i / idAlphabetLen) ) {
		ret += idAlphabet[i % idAlphabetLen];
	}
    // Let's finish with some extra randomness to avoid collisions
    // when calling this function more than 1 per second.
    for ( let i = 0 ; i<3 ; i++ ) {
        const r = Math.floor(Math.random() * idAlphabetLen);
        ret += idAlphabet[r];
    }
	return ret;
}

// MarkerIcon defines the icon of a marker as the offset of a background image.
export class MarkerIcon {
    width: number = 34;
    height: number = 34;
    bgX: number = 0;
    bgY: number = 0;
    image: string = '#';

    constructor(o: MarkerIcon) {
        Object.assign(this, o);
    }
}

// PositionedMarker defines a maker on a map.
export class PositionedMarker extends MarkerIcon {
    id: string;
    x: number = 0;
    y: number = 0;

    constructor(mi: MarkerIcon) {
        super(mi);
        this.id = newID();
    }
}

export class MasterSocket {
    private _roomID = '';
    private _auth = '';
    private _sPromise: Promise<WebSocket> | null = null;
    private _storageKey = '';

    // Callback which is called when the connection is established
    // with the roomID or with false if the connection is closed.
    onConnectionChange = (room: string | false) => {};
    
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
