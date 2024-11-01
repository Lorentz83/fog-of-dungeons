import { PositionedMarker, MarkerIcon } from "./api.mjs"


// LiveMarker is a wrapper around a PositionedMarker which enables HTML interactions.
class LiveMarker {
    private _container: HTMLDivElement;
    private _target: HTMLDivElement | null;
    private _config: PositionedMarker;
    
    constructor(container: HTMLDivElement, config: PositionedMarker) {
        this._config = config;

        this._container = container;
        this._target = document.createElement('div');
        this._target.classList.add('marker');
        this._container.appendChild(this._target);
        
        this._target.style.position = 'absolute';
        this._target.style.width = this._config.width + 'px';
        this._target.style.height = this._config.height + 'px';

        this._target.style.backgroundImage = `url('${this._config.image}')`;
        this._target.style.backgroundPosition = `-${this._config.bgX}px -${this._config.bgY}px`;
        
        this._move(this._config.x, this._config.y);

        this._target.classList.add('marker_in');
        const target = this._target;
        setTimeout(() => {
            target.classList.remove('marker_in');
        }, 10); // Doesn't have to be the same of the transition time.
    }

    toJSON(): PositionedMarker {
        // Deep copy, so old references don't hold new positions.
        return JSON.parse(JSON.stringify(this._config));
    }

    get id() {
        return this._config.id;
    }

    private _move(x: number, y: number) {
        if ( this._target === null ) {
            return;
        }
        this._config.x = x;
        this._config.y = y;
        this._target.style.top = y + 'px';
        this._target.style.left = x + 'px';
    }

    // Updates the marker position.
    update(cfg: {x:number, y:number}) {
        // Object.assign(this, config); Do we want to support morphing?
        this._move(cfg.x, cfg.y)
    }
    
    private _outsideBoundaries(x:number, y:number) {
        const left = - this._config.width;
        const right = + getComputedStyle(this._container).getPropertyValue('width').slice(0,-2);
        const top = - this._config.height;
        const bottom = + getComputedStyle(this._container).getPropertyValue('height').slice(0,-2);
        return ( x < left || x > right || y < top || y > bottom );
    }

    makeDraggable(onChange: (old: PositionedMarker, curr: LiveMarker) => void) {
        if ( this._target === null ) {
            return;
        }

        this._target.style.cursor = 'grab';
        this._target.style.pointerEvents = 'auto';
        this._target.style.touchAction = 'pinch-zoom';
        
        let old: PositionedMarker
        let held = {x: 0, y: 0};
        this._target.addEventListener('pointerdown', (ev)=>{
            if (ev.buttons != 1)
                return;
            ev.preventDefault();            
            this._target!.setPointerCapture(ev.pointerId);
            held = relativeCoordinates(this._target!, ev.clientX, ev.clientY);
            old = this.toJSON();
            this._target!.style.transition = 'unset'; // Disable transition on movement.
        });
        this._target.addEventListener('pointermove', (ev)=>{
            if (ev.buttons != 1)
                return;
            ev.preventDefault();
            const point = relativeCoordinates(this._container, ev.clientX, ev.clientY);
            this._move(point.x - held.x, point.y - held.y);
        });
        this._target.addEventListener('pointerup', (ev)=>{
            // Pointerup doesn't have buttons.
            const point = relativeCoordinates(this._container, ev.clientX, ev.clientY);
            const x = point.x - held.x;
            const y = point.y - held.y;
            this._move(x, y);
            this._target!.style.transition = ''; // Re-enable transition on movement.

            if ( this._outsideBoundaries(x, y) ) {
                this.delete();
            }
            onChange(old, this);
        });
    }

    delete() {
        if ( this._target === null ){
            return;
        }
        this._target.classList.add('marker_out');
        const target = this._target;
        setTimeout(() => { // Give time to the CSS transition.
            target.remove();
        }, 1000);
        this._target = null;
    }
    
    isDeleted() {
        return this._target == null;
    }
}

// MarkerPlacer allows a set of MarkerDescriptor to be placed and interacted in HTML.
export class MarkerPlacer {
    private _container: HTMLDivElement;
    private _markers = new Map<string, LiveMarker>();

    // onMarkerChange is the callback called every time the user interacts (moves or deletes) a marker.
    // The parameter is the list of actives markers.
    onMarkerChange = (prev: PositionedMarker[], curr: PositionedMarker[]) => {};
    
    constructor(container: HTMLDivElement) {
        this._container = container;
        this._container.style.overflow = 'hidden';
    }

    // reset deletes all the markers.
    reset() {
        this._container.innerHTML = '';
        this._markers = new Map();
    }

    // adds a new marker
    add(mi: MarkerIcon) {
        const old = this.getList();
        const cfg = new PositionedMarker(mi);

        // Center it in the container.
        let x = +getComputedStyle(this._container).getPropertyValue('width').slice(0,-2);
        let y = +getComputedStyle(this._container).getPropertyValue('height').slice(0,-2);
        cfg.x = Math.round( x / 2 - cfg.width / 2);
        cfg.y = Math.round( y / 2 - cfg.height / 2);

        const m = new LiveMarker(this._container, cfg);
        this._markers.set(cfg.id, m);
        this._makeDraggable(m);
        this.onMarkerChange(old, this.getList());
    }

    private _makeDraggable(m: LiveMarker) {
        m.makeDraggable( (oldM, marker) => {
            const old = this.getList();
            if ( marker.isDeleted() ) {
                this._markers.delete(marker.id);
                old.push(oldM);
            } else {
                for ( let i = 0 ; i < old.length ; i++ ) {
                    if ( old[i].id === m.id ) {
                        old[i] = oldM;
                    }
                }
            }
            this.onMarkerChange(old, this.getList());
        });
    }

    getList(): PositionedMarker[] {
        return [...this._markers.values()].map(m => m.toJSON());
    }

    // Loads all the markers, markers already known (with the same ID) are moved.
    // Markers missing in the list are deleted.
    // New markers are added.
    // draggable defines if the new markers can be moved by the user.
    load(mm: PositionedMarker[], draggable: boolean) {
        const allIDs = new Set();
        for ( const cfg of mm ) {
            const id = cfg.id;
            allIDs.add(id);
            let m = this._markers.get(id);
            if ( m ) {
                m.update(cfg);
            } else {
                m = new LiveMarker(this._container, cfg);
                if ( draggable ) {
                    this._makeDraggable(m);
                }
                this._markers.set(id, m);
            }
        }
        for (const [id, m] of this._markers) {
            if ( allIDs.has(id) ) {
                continue;
            }
            this._markers.delete(id);
            m.delete();
        }
    }
    
}

class CanvasCursor {
    readonly element: HTMLCanvasElement;
    size = 30;
    blurMultiplier = .3;

    private _clearCursorTimer: number | undefined;

    constructor() {
        this.element = document.createElement('canvas');

        this.element.style.display = 'block';
        this.element.style.position = 'absolute';
        this.element.style.top = '0';
        this.element.style.pointerEvents = 'none';
    }

    previewSize() {
        // TODO don't move the cursor if it is still in position.
        const x = this.element.width / 2;
        const y = this.element.height / 2;
        this.move(x, y);
    }

    resize(x: number, y: number) {
        this.element.width = x;
        this.element.height = y;
        this.clear();
    }

    clear() {
        const ctx = this.element.getContext('2d')!;
        ctx.clearRect(0, 0, this.element.width, this.element.height);
    }
    
    move(x: number, y: number) {
        // Touchscreens cannot notify mouse leave event, so we hide the cursor after some inactivity.
        clearTimeout(this._clearCursorTimer);
        this._clearCursorTimer = setTimeout( () => {
            this.clear()
        }, 3000);
        
        const ctx = this.element.getContext('2d')!;
        const size = this.size / this.blurMultiplier / 2; // need to compensate for the blur.
        ctx.clearRect(0, 0, this.element.width, this.element.height);
        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.arc(x, y, size, 0, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#fff';
        ctx.arc(x, y, size, Math.PI, Math.PI * 2);
        ctx.stroke();
    }
}

class CustomCanvas {
    readonly element: HTMLCanvasElement

    constructor() {
        this.element = document.createElement('canvas');
        this.element.style.display = 'block';
    }

    resize(x: number, y: number) {
        this.element.width = x;
        this.element.height = y;
    }

    clear() {
        const ctx = this.element.getContext('2d')!;
        ctx.clearRect(0, 0, this.element.width, this.element.width);
    }

    fill(color: string) {
        const ctx = this.element.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.clearRect(0, 0, this.element.width, this.element.height);
        ctx.rect(0, 0, this.element.width, this.element.height);
        ctx.fill();
    }

    eraser(x: number, y: number, cfg: {cursorSize: number, blurMultiplier: number}) {
        const blurRadius = cfg.cursorSize * cfg.blurMultiplier;
        const ctx = this.element.getContext('2d')!;
        ctx.beginPath();
        ctx.globalCompositeOperation = `destination-out`;
        ctx.filter = `blur(${blurRadius}px)`;
        ctx.arc(x, y, cfg.cursorSize, 0, Math.PI * 2);
        ctx.fill();
    }

    exportBlob(type?: string | undefined, quality?: any): Promise<Blob> {
        return new Promise<Blob>( (resolve, reject) => {
            this.element.toBlob( (blob) => resolve(blob!) , type, quality);
        });
    }
    
    setImage(img: string | Blob, config: {resizeCanvas?: boolean, maxWidth?: number, maxHeight?: number, alpha?: boolean} = {}): Promise<void> {
        return new Promise((resolve, reject) => {
            const ri = document.createElement('img');
            ri.addEventListener('error', (ev) => {
                reject('cannot load image');
            });
            ri.addEventListener('load', (ev) => {
                try {
                    let w = this.element.width;
                    let h = this.element.height;
                    if ( config.resizeCanvas ) {
                        w = ri.width;
                        h = ri.height;
                        let maxWidth = config.maxWidth || 0;
                        let maxHeight = config.maxHeight || 0;
                        if ( w > 0 && w > maxWidth ) {
                            h = Math.floor(h * maxWidth / w);
                            w = maxWidth;
                        }
                        if ( h > 0 && h > maxHeight ) {
                            w = Math.floor(w * maxHeight / h);
                            h = maxHeight;
                        }
                        this.resize(w, h);
                    }

                    const ctx = this.element.getContext('2d', { alpha: config.alpha === true })!;
                    ctx.reset(); // defog sets the ctx to delete.
                    ctx.drawImage(ri, 0, 0, w, h);
                    resolve();
                } catch(e) {
                    reject(e);
                } finally {
                    ri.remove();
                    URL.revokeObjectURL(ri.src); // Ignores urls that ere not created by createObjectURL
                }
            })
            if ( img instanceof Blob ) {
                ri.src = URL.createObjectURL(img);
            } else {
                ri.src = img;
            }
        });
    }
}

export class Painter {
    private _lastSavedFogUndo = -1;
    private _undoList = new Array< string | PositionedMarker[] >();
    private _canvasBase: CustomCanvas;
    private _canvasFog: CustomCanvas;
    private _cursor: CanvasCursor;
    private _markerPlacer: MarkerPlacer;
    private _notifyDefogTimer?: number;

    maxWidth = 1024;
    maxHeight = 1024;
    exportFormat = 'image/jpeg';
    exportCompression = 0.9;
    notifyDefogCallback: (() => void) | null = null;
    onMarkerChange = (mm: PositionedMarker[]) => {};
    notifyDefogDelayMs = 500;
    maxUndo = 40;
    minSpanSaveUndoMS = 1000;
    
    get cursorSize() {
        return this._cursor.size;
    }
    set cursorSize(val: number) {
        this._cursor.size = val;
        this._cursor.previewSize();
    }

    set blurMultiplier(val: number) {
        this._cursor.blurMultiplier = val;
        this._cursor.previewSize();
    }
    get blurMultiplier() {
        return this._cursor.blurMultiplier;
    }
    
    set fogOpacity(val: number) {
        this._canvasFog.element.style.opacity = ''+val;
    }

    constructor(mapContainer: HTMLDivElement) {
        this._canvasBase = new CustomCanvas();
        this._canvasFog = new CustomCanvas();
        this._cursor = new CanvasCursor();

        this._canvasFog.element.style.position = 'absolute';
        this._canvasFog.element.style.top = '0';

        const markerContainer = document.createElement('div');
        markerContainer.style.pointerEvents = 'none';
        markerContainer.style.position = 'absolute';
        markerContainer.style.top = '0';
        markerContainer.style.bottom = '0';
        markerContainer.style.left = '0';
        markerContainer.style.right = '0';

        this._markerPlacer = new MarkerPlacer(markerContainer);
        
        mapContainer.style.position = 'relative';
        mapContainer.style.cursor = 'crosshair';
        mapContainer.style.width = 'fit-content';
        mapContainer.style.height = 'fit-content';
        // mapContainer.style.userSelect = 'none';
        mapContainer.style.touchAction = 'pinch-zoom';
        
        mapContainer.appendChild(this._canvasBase.element);
        mapContainer.appendChild(this._canvasFog.element);
        mapContainer.appendChild(this._cursor.element);
        
        mapContainer.appendChild(markerContainer);

        this.reset();
        
        this._markerPlacer.onMarkerChange = (prev: PositionedMarker[], curr: PositionedMarker[]) => {
            this._saveUndo(prev);
            this.onMarkerChange(curr);
        };

        let multiTouch = false;
        this._canvasFog.element.addEventListener('touchstart', (ev)=>{
            multiTouch = ev.touches.length > 1;
            if ( ! multiTouch ) {
                this._saveFogUndo(); 
            }
        });
        this._canvasFog.element.addEventListener('pointermove', (ev)=>{
            if ( multiTouch )
                return;
            this._canvasFog.element.setPointerCapture(ev.pointerId);
            
            const point = relativeCoordinates(ev.currentTarget as HTMLElement, ev.clientX, ev.clientY);

            this._cursor.move(point.x, point.y);
            if (ev.buttons != 1)
                return;
            this.defog(point.x, point.y);
        });
        this._canvasFog.element.addEventListener('mousedown', (ev)=>{
            // Doesn't work on touch by design, so we can detect pinch zoom.
            multiTouch = false;

            if (ev.buttons != 1)
                return;
            const point = relativeCoordinates(ev.currentTarget as HTMLElement, ev.clientX, ev.clientY);
            this._saveFogUndo();
            this.defog(point.x, point.y);
        });
        this._canvasFog.element.addEventListener('mouseleave', (ev)=>  this._cursor.clear() );
    }
    
    addMarker(cfg: MarkerIcon) {
        this._markerPlacer.add(cfg);
    }

    loadMarkers(markers: PositionedMarker[], draggable: boolean) {
        this._markerPlacer.load(markers, draggable);
    }
    
    reset() {
        const w = 200;
        const h = 200;
        this._canvasBase.resize(w, h);
        this._canvasFog.resize(w, h);
        this._cursor.resize(w, h);

        this._canvasFog.clear();
        this._canvasBase.fill('#ccc');
        this._markerPlacer.reset();
    }
    
    setFog(img: string | Blob): Promise<void> {
        return this._canvasFog.setImage(img, {alpha: true});
    }
    
    async setMap(img: string | Blob): Promise<void> {
        this._undoList = [];
        await this._canvasBase.setImage(img, {resizeCanvas: true, maxWidth: this.maxWidth, maxHeight: this.maxHeight});
        const w = this._canvasBase.element.width;
        const h = this._canvasBase.element.height;
        this._canvasFog.resize(w, h);
        this._cursor.resize(w, h);
        return Promise.resolve();
    }

    fillFog(color: string) {
        this._canvasFog.fill(color);
    }

    defog(x: number, y: number) {
        this._canvasFog.eraser(x, y, {cursorSize: this.cursorSize, blurMultiplier: this.blurMultiplier});
        this._notifyDefog();
    }

    async undo() {
        const undo = this._undoList.pop();
        if ( undo === undefined ) {
            console.log('nothing to undo');
            return false;
        }

        if ( typeof undo === 'string' ) {
            await this.setFog(undo);
            this._notifyDefog();
        } else {
            this._markerPlacer.load(undo, true);
            this.onMarkerChange(this._markerPlacer.getList());
        }
        return true;
    }
    
    private _saveFogUndo() {
        if ( this.maxUndo <= 0 ) {
            return;
        }
        const n = performance.now();
        if ( n - this._lastSavedFogUndo < this.minSpanSaveUndoMS ) {
            return;
        }
        this._lastSavedFogUndo = n;
        
        this._saveUndo(this._canvasFog.element.toDataURL());
    }

    private _saveUndo(el: string | PositionedMarker[] ) {
        this._undoList.push(el);
        if ( this._undoList.length > this.maxUndo ) {
            this._undoList.slice(- this.maxUndo);
        }
    }
    
    private _notifyDefog() {
        if ( this.notifyDefogCallback === null ) {
            return;
        }
        if ( this._notifyDefogTimer ) {
            clearTimeout(this._notifyDefogTimer);
            this._notifyDefogTimer = undefined;
        }
        this._notifyDefogTimer = setTimeout( () => {
            if (this.notifyDefogCallback)
                this.notifyDefogCallback();
        }, this.notifyDefogDelayMs);
    }

    saveBase() {
        return this._canvasBase.exportBlob(this.exportFormat, this.exportCompression);
    }

    saveFog() {
        return this._canvasFog.exportBlob('image/png'); // We need transparent here.
    }
    
    saveMerged() {
        const m = document.createElement('canvas');
        m.width = this._canvasBase.element.width;
        m.height = this._canvasBase.element.height;
        
        const ctx = m.getContext('2d')!;

        ctx.drawImage(this._canvasBase.element, 0, 0);
        ctx.drawImage(this._canvasFog.element, 0, 0);

        return m.toDataURL(this.exportFormat, this.exportCompression);
    }
}

function relativeCoordinates(obj: HTMLElement, x: number, y: number) {
    const styling = getComputedStyle(obj);
    const topBorder = + styling.getPropertyValue('border-top-width').slice(0,-2);
    const leftBorder = + styling.getPropertyValue('border-left-width').slice(0,-2);

    const rect = obj.getBoundingClientRect();

    return {
        x : x - rect.left - leftBorder, 
        y : y - rect.top - topBorder
    };
}
