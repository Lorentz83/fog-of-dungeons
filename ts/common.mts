// Contains the shared code between players and master.

const idAlphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const idAlphabetLen = idAlphabet.length;

// KeepAwake is a convenience wrapper around the wake lock API.
// It handles automatic reacquiring when the tab gets back in focus.
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

// A simple snackbar.
//
// TODO it would be nice to implement timeout and handle multiple snackbars visible at the same time.
export  class SnackBar {
    private _dialog: HTMLDialogElement;
    private _colorBox: HTMLElement;
    private _textContent: HTMLDivElement;
    private _closeBtn: HTMLButtonElement;
    private _timer?: number;
    private _timeoutMS: number;

    constructor(closeTimeoutMS: number = 3000) {
        this._timeoutMS = closeTimeoutMS; 

        this._dialog = document.createElement('dialog');
        document.body.appendChild(this._dialog);
        this._dialog.classList.add('snackbar');
        this._dialog.style.position = 'fixed';
        this._dialog.style.bottom = '50px';
        this._dialog.style.zIndex = '10000';
        this._dialog.style.borderRadius = '20px';
        this._dialog.style.border = 'none';
        this._dialog.style.width = '50%';
        this._dialog.style.color = 'white';
        this._dialog.style.backgroundColor = 'black';
        this._dialog.style.overflow = 'hidden';
        this._dialog.style.padding = '0';
        this._dialog.style.height = '4em';
        this._dialog.style.boxShadow = '0 0 5px white';

        const dialogContent = document.createElement('div');
        this._dialog.appendChild(dialogContent);
        dialogContent.style.display = 'flex'; // Cannot set dialog as flex otherwise it is always visible.
        dialogContent.style.width = '100%';
        dialogContent.style.height = '100%';
        dialogContent.style.alignItems = 'center';

        this._colorBox = document.createElement('div');
        dialogContent.appendChild(this._colorBox);
        this._colorBox.style.width = '1em';
        this._colorBox.style.height = '100%';
        this._colorBox.style.backgroundColor = 'red';

        this._textContent = document.createElement('div');
        dialogContent.append(this._textContent);
        this._textContent.style.flexGrow = '2';
        this._textContent.style.padding = '0 1em';
        this._textContent.style.textOverflow = 'ellipsis';
        this._textContent.style.overflow = 'hidden';
        

        this._closeBtn = document.createElement('button');
        dialogContent.appendChild(this._closeBtn);
        this._closeBtn.style.height = '100%';
        this._closeBtn.style.border = 'none';
        this._closeBtn.style.background = 'none';
        this._closeBtn.style.padding = '1.5em';

        const closeImg = document.createElement('img');
        this._closeBtn.appendChild(closeImg);
        closeImg.src = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%20version%3D%221.1%22%20width%3D%22256%22%20height%3D%22256%22%20viewBox%3D%220%200%20256%20256%22%20xml%3Aspace%3D%22preserve%22%3E%3Cg%20style%3D%22stroke%3A%20none%3B%20stroke-width%3A%200%3B%20stroke-dasharray%3A%20none%3B%20stroke-linecap%3A%20butt%3B%20stroke-linejoin%3A%20miter%3B%20stroke-miterlimit%3A%2010%3B%20fill%3A%20none%3B%20fill-rule%3A%20nonzero%3B%20opacity%3A%201%3B%22%20transform%3D%22translate(1.4065934065934016%201.4065934065934016)%20scale(2.81%202.81)%22%3E%3Cpath%20d%3D%22M%2028.902%2066.098%20c%20-1.28%200%20-2.559%20-0.488%20-3.536%20-1.465%20c%20-1.953%20-1.952%20-1.953%20-5.118%200%20-7.07%20l%2032.196%20-32.196%20c%201.951%20-1.952%205.119%20-1.952%207.07%200%20c%201.953%201.953%201.953%205.119%200%207.071%20L%2032.438%2064.633%20C%2031.461%2065.609%2030.182%2066.098%2028.902%2066.098%20z%22%20style%3D%22stroke%3A%20none%3B%20stroke-width%3A%201%3B%20stroke-dasharray%3A%20none%3B%20stroke-linecap%3A%20butt%3B%20stroke-linejoin%3A%20miter%3B%20stroke-miterlimit%3A%2010%3B%20fill%3A%20rgb(255%2C255%2C255)%3B%20fill-rule%3A%20nonzero%3B%20opacity%3A%201%3B%22%20transform%3D%22%20matrix(1%200%200%201%200%200)%20%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M%2061.098%2066.098%20c%20-1.279%200%20-2.56%20-0.488%20-3.535%20-1.465%20L%2025.367%2032.438%20c%20-1.953%20-1.953%20-1.953%20-5.119%200%20-7.071%20c%201.953%20-1.952%205.118%20-1.952%207.071%200%20l%2032.195%2032.196%20c%201.953%201.952%201.953%205.118%200%207.07%20C%2063.657%2065.609%2062.377%2066.098%2061.098%2066.098%20z%22%20style%3D%22stroke%3A%20none%3B%20stroke-width%3A%201%3B%20stroke-dasharray%3A%20none%3B%20stroke-linecap%3A%20butt%3B%20stroke-linejoin%3A%20miter%3B%20stroke-miterlimit%3A%2010%3B%20fill%3A%20rgb(255%2C255%2C255)%3B%20fill-rule%3A%20nonzero%3B%20opacity%3A%201%3B%22%20transform%3D%22%20matrix(1%200%200%201%200%200)%20%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M%2045%2090%20C%2020.187%2090%200%2069.813%200%2045%20C%200%2020.187%2020.187%200%2045%200%20c%2024.813%200%2045%2020.187%2045%2045%20C%2090%2069.813%2069.813%2090%2045%2090%20z%20M%2045%2010%20c%20-19.299%200%20-35%2015.701%20-35%2035%20s%2015.701%2035%2035%2035%20s%2035%20-15.701%2035%20-35%20S%2064.299%2010%2045%2010%20z%22%20style%3D%22stroke%3A%20none%3B%20stroke-width%3A%201%3B%20stroke-dasharray%3A%20none%3B%20stroke-linecap%3A%20butt%3B%20stroke-linejoin%3A%20miter%3B%20stroke-miterlimit%3A%2010%3B%20fill%3A%20rgb(255%2C255%2C255)%3B%20fill-rule%3A%20nonzero%3B%20opacity%3A%201%3B%22%20transform%3D%22%20matrix(1%200%200%201%200%200)%20%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';
        closeImg.style.height = '100%';

        this._closeBtn.addEventListener('click', () => this.close() );
    }

    show(color: string, message: string) {
        this._colorBox.style.backgroundColor = color;
        this._textContent.textContent = message;
        this._dialog.show();
        this._closeBtn.blur(); // unfocus to remove border.

        this._timer = setTimeout(() => {
            this.close();
        }, this._timeoutMS);
    }
    
    alert(message: string) {
        this.show('red', message);
    }
    
    info(message: string) {
        this.show('green', message);
    }

    close() {
        this._dialog.close();
        clearTimeout(this._timer);
        this._timer = undefined;
    }
}

// newID returns a short human readable ID.
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
