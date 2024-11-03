import { PlayerSocket, keepAwakeCheckbox } from "./api.mjs"
import { MarkerPlacer } from "./painter.mjs"

class ImageSwitcher {
    private _container: HTMLDivElement;
    private _img1: HTMLImageElement;
    private _img2: HTMLImageElement;
    private _lastImgSet: HTMLImageElement | null = null;

    constructor(container: HTMLDivElement, src: string) {
        this._container = container;
        this._img1 = document.createElement('img');
        this._img2 = document.createElement('img');

        this._img1.src = src;
        this._img2.src = src;

        this._img1.addEventListener('load', (e) => this._switch(e) );
        this._img2.addEventListener('load', (e) => this._switch(e) );
        
        container.classList.add('image_switcher');
        // The size of the switcher is the size of img1.
        // Setting the initial image as alt, we allow resizing from
        // the spinner to the map.
        container.classList.add('image_switcher_alt');
        container.innerHTML = '';
        container.appendChild(this._img1);
        container.appendChild(this._img2);
    }

    private _switch(e: Event) {
        if ( e.target !== this._lastImgSet ) {
            console.log('img out of sync, not switching');
            return;
        }
        this._container.classList.toggle('image_switcher_alt');
    }
    
    set src(val: string) {
        this._lastImgSet = this._img2;
        if ( this._container.classList.contains('image_switcher_alt') ) {
            this._lastImgSet = this._img1;
        }
        this._lastImgSet.src = val;
    }
}

class Connection {
    close = () => {}
    reconnect = () => {}
}

function loadMap(roomID: string, container: HTMLDivElement, status: HTMLElement): Connection {
    const ret = new Connection();

    if ( !roomID ) {
        container.innerText = 'Ask your master for a map URL.';
        status.innerText = 'disconnected';
        return ret;
    }

    status.innerText = 'connecting...';

    const img = new ImageSwitcher(container, './spinner.gif');
    const markerPlacer = new MarkerPlacer(container);
    
    const api = new PlayerSocket(roomID);
    api.onMap = (mapURL) => { img.src = mapURL };
    api.onMarkers = (markers) => { markerPlacer.load(markers, false) };
    api.onConnectionChange = (room) => {
        if ( room === false ) {
            status.innerText = 'disconnected';
        } else {
            status.innerText = `room: ${room}`;
        }
    };
    
    api.connect().catch(ex => {
        console.error('API error: ', ex)
        container.innerText = 'Error: check your internet connection and check your master is online';
    });
    
    ret.close = () => { api.close() };
    ret.reconnect = () => {api.connect() };
    return ret;
}

function adjustZoom() {
    const zoomable = document.getElementById('zoomable')!;

    // fullscreenArea.classList.add('no_transitions');
    // setTimeout( () => fullscreenArea.classList.remove('no_transitions') , 1000 );

    if (document.fullscreenElement) {
        const vp = document.fullscreenElement.getBoundingClientRect()
        zoomable.style.width = 'fit-content';
        const zw = vp.width / zoomable.offsetWidth;
        const zh = vp.height / zoomable.offsetHeight;
        const zoom = Math.min(zw, zh);
        // Note: despite the zoom property should be better, it looks like it doesn't 
        // scale everything the same way.
        // Also, nor zoom or scale can be applied to the full screen element. 
        zoomable.style.transform = `scale(${zoom})`;
    } else {
        zoomable.style.transform = 'none';
    }
}

function getRoomID(): string {
    const editPrefix = '#id=';
    const h = window.location.hash;
    const id = h.substring(editPrefix.length);
    if ( id == '' || ! h.startsWith(editPrefix) ) {
        throw new Error("Map ID missing, check the the URL");
    }
    return id;
}

function playerInit() {
    try {
        const roomID = getRoomID();
        const container = document.getElementById('map_container') as HTMLDivElement;
        const status = document.getElementById('status') as HTMLElement;
        let connection = loadMap(roomID, container, status);
        
        addEventListener('hashchange', () => {
            connection.close();
            const id = getRoomID();
            connection = loadMap(id, container, status);
        } );


        document.addEventListener('visibilitychange', () => {
            if ( document.visibilityState == 'visible' ) {
                connection.reconnect();
            }
        });

    } catch(ex) {
        let msg = 'unknown error';
        if ( ex instanceof Error ) {
            msg = ex.message;
        }
        alert(msg);
    }

    keepAwakeCheckbox(document.getElementById('keep_awake') as HTMLInputElement);

    document.getElementById('fullscreen_btn')!.addEventListener('click', () => {
        document.getElementById('fullscreen_area')!.requestFullscreen();
    } );
    window.addEventListener('fullscreenchange', adjustZoom);
    window.addEventListener('resize', adjustZoom);
}

window.addEventListener('load', () => playerInit() );
