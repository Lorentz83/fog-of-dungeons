import { PositionedMarker, MasterSocket, MarkerIcon, keepAwakeCheckbox } from "./api.mjs"
import { MapStorage, StoredMap } from "./storage.mjs"
import { Painter } from "./painter.mjs"


async function populateMapList(storage: MapStorage, ul: HTMLElement, makeLink: (id:string) => string) {
    ul.innerHTML = '';
    for ( let m of await storage.allMaps() ) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = makeLink(m.id);
        a.innerText = m.title;
        li.appendChild(a);
        li.appendChild(document.createTextNode(' '));
        const b = document.createElement('button');
        b.appendChild(document.createTextNode('Delete'));
        b.onclick = () => {
            b.disabled = true;
            storage.deleteMap(m.id)
                .then( () => li.remove() )
                .catch( (ex) => {
                    b.disabled = false;
                    alert(ex.message);
                });
        };
        li.appendChild(b);
        ul.appendChild(li);
    }
}

// Handles the dialog to add a marker.
// onSelect is called when a new marker is choosen.
class AddMarkerDialog {
    private _dialog: HTMLDialogElement;
    onSelect = (cfg: MarkerIcon) => {};

    constructor() {
        this._dialog = document.getElementById('new_marker_dialog') as HTMLDialogElement;

        const img = this._dialog.querySelector('img') as HTMLImageElement;
        const w = + (img.dataset.width as string);
        const h = + (img.dataset.height as string);
        
        img.addEventListener('click', ev => {
            const rect = img.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;

            // NOTE: here is hardcoded the assumption that the markers
            // are referenced with the same relative URL in both
            // master and player pages.
            const src = img.getAttribute('src') as string;
            
            const config = {
                width: w,
                height: h,
                bgX: Math.floor( x / w ) * w,
                bgY: Math.floor( y / h ) * h,
                image: src,
            }
            this._dialog.close();
            this.onSelect(config);
        });
    }
    
    showModal() {
        this._dialog.showModal();
    }
}

class NewMapDialog {
    private _dialog: HTMLDialogElement;
    private _form: HTMLFormElement;
    private _name: HTMLInputElement;
    private _fogColor: HTMLInputElement;
    private _file: HTMLInputElement;
    private _submit: HTMLButtonElement;

    onAccept = (mapName: string, img: Blob, color: string) => { return Promise.resolve() };

    constructor() {
        this._dialog = document.getElementById('new_map_dialog') as HTMLDialogElement;
        this._form = document.querySelector('#new_map_dialog form') as HTMLFormElement;
        this._name = document.querySelector('#new_map_dialog input[name="map_name"]') as HTMLInputElement;
        this._fogColor = document.querySelector('#new_map_dialog input[name="fog_color"]') as HTMLInputElement;
        this._file = document.querySelector('#new_map_dialog input[name="map_file"]') as HTMLInputElement;
        this._submit = document.querySelector('#new_map_dialog button[value="submit"]') as HTMLButtonElement;
        
        this._submit.addEventListener('click', (ev) => this._submitHandler(ev) );

        document.querySelector('#new_map_dialog button[value="cancel"]')!.addEventListener('click', (ev) => { this._form.reset() });
    }

    showModal() {
        this._dialog.showModal();
    }

    close() {
        this._dialog.close();
        this._form.reset();
    }
    
    private async _submitHandler(ev: Event) {
        if ( ! this._form.reportValidity() ) {
            return;
        }
        ev.preventDefault(); // We want to close the window once the image is loaded correctly.
        this._submit.disabled = true;
        try {
            const color = this._fogColor.value;
            const name = this._name.value;
            const img = this._file.files![0];
            await this.onAccept(name, img, color);
            this.close();
        } catch(ex) {
            alert(ex); // TODO nicer error message.
        } finally {
            this._submit.disabled = false;
        }
    }
}

class Pagination {
    private _editPrefix = '#id=';
    onLanding = () => {};
    onEdit = (id: string) => {};

    constructor() {
        addEventListener("hashchange", (ev) => {
            this.forceCheck();
        });
    }

    navigateEditMap(id: string) {
        window.location.hash = this._editPrefix + id;
    }
    
    makeEditMapLink(id: string) {
        return this._editPrefix + id;
    }
    
    forceCheck() {
        const h = window.location.hash;
        if ( h.startsWith(this._editPrefix) ) {
            const id = h.substring(this._editPrefix.length)
            this.onEdit(id);
            document.body.classList.add('edit_mode');
        } else if ( h == '' || h == '#' ) {
            document.body.classList.remove('edit_mode');
            this.onLanding();
        } else {
            console.log('unknown hash ', h)
        }
    }
}

async function initMaster() {
    const keepAwake = keepAwakeCheckbox(document.getElementById('keep_awake') as HTMLInputElement);
    
    const storage = await MapStorage.init();
    const painter = new Painter(document.getElementById('map_container') as HTMLDivElement);

    const mapList = document.getElementById('map_list') as HTMLElement;

    const playerLink = document.getElementById('player_link') as HTMLAnchorElement;
    const status = document.getElementById('status') as HTMLElement;
    const disconnectedChip = document.getElementById('disconnected')!;

    playerLink.addEventListener('click', (ev) => {
        if ( playerLink.getAttribute('href') === '#' ) {
            alert('Check your internet connection and try to interact with the map again to see if you can reconnect.');
            ev.preventDefault();
        }
        try {
            navigator.share({
                url: playerLink.href,
                title: 'Fog of Dungeons',
            });
            ev.preventDefault();
        } catch (ex) {
            // Ignore the error, we'll open the link in a new tab.
        }
    });

    let api: MasterSocket | null;
    const pagination = new Pagination();
    pagination.onLanding = () => {
        keepAwake.disable();
        if (api) {
            api.close();
            api = null;
        }
        populateMapList(storage, mapList, (id: string) => pagination.makeEditMapLink(id));
        painter.reset();
    };
    pagination.onEdit = async (mapID: string) => {
        try {
            api = new MasterSocket(mapID);
            api.onConnectionChange = (room) => {
                if ( room === false ) {
                    disconnectedChip.style.visibility = 'visible';
                    status.innerText = 'disconnected';
                    playerLink.href = '#';
                } else {
                    disconnectedChip.style.visibility = 'hidden';
                    status.innerText = `room: ${room}`;
                    playerLink.href = `./player.html#id=${room}`
                }
            };
            const onDefog = async() => {
                try {
                    painter.saveFog()
                        .then( f => storage.saveMapLayer(mapID, 'fog', f) );
                    await api!.sendMap(painter.saveMerged());
                } catch (ex) {
                    let msg = 'unknown error';
                    if ( ex instanceof Error ) {
                        msg = ex.message;
                    }
                    alert(msg);
                }
            };

            const onMarkerChange = (markers: PositionedMarker[]) => {
                Promise.all([
                    api!.sendMarkers(markers),
                    storage.saveMapLayer(mapID, 'markers', markers)
                ]).catch( (ex) => alert(ex.message) );
            }

            const map = await storage.getMap(mapID);

            await painter.setMap(map.base);
            // after the base map is set we can load the rest.
            painter.loadMarkers(map.markers, true);
            api!.sendMarkers(map.markers);
            await painter.setFog(map.fog);
            // Once the fog is set we can send the map to the players.
            painter.notifyDefogCallback = onDefog;
            painter.onMarkerChange = onMarkerChange;
            api!.sendMap(painter.saveMerged());
        } catch(ex) {
            let msg = 'unknown error';
            if ( ex instanceof Error ) {
                msg = ex.message
            }
            alert(msg);
        }
    };
    pagination.forceCheck();

    const addMarkerDialog  = new AddMarkerDialog();
    addMarkerDialog.onSelect = (cfg) => painter.addMarker(cfg);
    
    document.getElementById('add_marker')!.addEventListener('click', ()=> addMarkerDialog.showModal() );
    
    const newMapDialog = new NewMapDialog();
    newMapDialog.onAccept = async (name: string, img: Blob, color: string) : Promise<void> => {
        painter.notifyDefogCallback = null;
        await painter.setMap(img);
        painter.fillFog(color);

        const base = painter.saveBase();
        const fog = painter.saveFog();

        const map = new StoredMap({
            title: name,
            base: await base,
            fog: await fog,
            markers: [],
        });

        await storage.saveMap(map); // We want to be sure it is committed.

        painter.reset();
        pagination.navigateEditMap(map.id);
    };
    
    document.getElementById('new_map_btn')!.addEventListener('click', () => {
        newMapDialog.showModal();
    });

    const fogOpacity = document.getElementById('fog_opacity') as HTMLInputElement;
    painter.fogOpacity = +fogOpacity.value / 100;
    fogOpacity.addEventListener('input', (ev) => {
        painter.fogOpacity = +(ev.target as HTMLInputElement).value / 100;
    });

    const defogSize = document.getElementById('defog_size') as HTMLInputElement;
    painter.cursorSize = +defogSize.value;
    defogSize.addEventListener('input', (ev) => {
        painter.cursorSize = +(ev.target as HTMLInputElement).value;
    });

    document.getElementById('undo')!.addEventListener('click', (ev) => painter.undo() );
    window.addEventListener('keydown', (ev) => {
        if (ev.ctrlKey && ev.key == 'z') {
            painter.undo();
        }
    });
}

window.addEventListener('load', (ev) => { initMaster() });

