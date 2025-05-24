
const idAlphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const idAlphabetLen = idAlphabet.length;

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
        this.set(true);
    }

    async set(enable: boolean): Promise<void> {
        if ( enable ) {
            return this.enable();
        } else {
            return this.disable();
        }
    }

    // Re acquire wakelock if we go back to this tab.
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
