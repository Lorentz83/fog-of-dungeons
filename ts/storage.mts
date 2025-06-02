// Implements the map storage in the master's local browser storage.
// Used by the master only.

import { PositionedMarker, newID } from "./common.mjs"

// LayerType represents the layers of the map.
// Used to specify which layer to update without having to re-send the full StoredMap.
export type LayerType = 'base' | 'fog' | 'markers';

// StoredMapBuilder is just an interface so the caller can create a
// StoredMap from an object without the map ID.
interface StoredMapBuilder {
    title: string;
    base: Blob;
    fog: Blob;
    markers: PositionedMarker[];
}

// StoredMap represents a map stored in the local browser DB.
export class StoredMap {
    id: string;
    title: string;
    base: Blob;
    fog: Blob;
    markers: PositionedMarker[];

    // A new ID is created for each new instance of StoredMap, 
    // therefore the caller should use this constructor only for new maps.
    // For existing maps the caller should use only the object returned from MapStorage.
    constructor(b: StoredMapBuilder) {
        this.id = newID();
        this.title = b.title;
        this.base = b.base;
        this.fog = b.fog;
        this.markers = b.markers;
    }
}

// MapStorage implements specialized functions to save and load maps from the local DB.
export class MapStorage {
    private _db: IDBDatabase;
    
    private static newDB(): Promise<IDBDatabase> {
        const request = indexedDB.open('uncovermap', 2);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            // We are still beta, deleting old data is acceptable.
            try {
                db.deleteObjectStore('maps');
            } catch (ex) {} // Likely a not found.
            db.createObjectStore('maps', { keyPath: 'id' });
        };
    
        return new Promise((resolve, reject) => {
            request.onerror = (event) => {
                console.error('Cannot use IndexedDB', event);
                reject('Cannot access to local storage');
            };
            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };
        });
    }

    static async init() {
        return new MapStorage(await MapStorage.newDB());
    }

    private constructor(db: IDBDatabase) {
        this._db = db;
    }

    allMaps(): Promise<StoredMap[]> {
        const cursor = this._db.transaction(['maps'], 'readonly').objectStore('maps').openCursor();
        return new Promise( (resolve, reject) => {
            cursor.onerror = (event) => {
                console.log('list error', event);
                reject('cannot list maps');
            };
            const ret: StoredMap[] = [];
            cursor.onsuccess = () => {
                const res = cursor.result
                if (res) {
                    const map = res.value;
                    ret.push(map);
                    res.continue();
                }
                else {
                    resolve(ret);
                }
            };
        });
    }

    saveMap(map: StoredMap): Promise<null> {
        const transaction = this._db.transaction(['maps'], 'readwrite');
        return new Promise( (resolve, reject) => {
            transaction.oncomplete = (event) => {
                console.log('transaction', event);
                resolve(null);
            };
            transaction.onerror = (event) => {
                console.log('error', event);
                reject('cannot save map');
            };
            transaction.objectStore('maps').add(map);
        });
    }

    deleteMap(mapID: string): Promise<null> {
        const transaction = this._db.transaction(['maps'], 'readwrite');
        return new Promise( (resolve, reject) => {
            transaction.oncomplete = (event) => {
                console.log('map deleted', mapID);
                resolve(null);
            };
            transaction.onerror = (event) => {
                console.log('error', event);
                reject('cannot delete map');
            };
            transaction.objectStore('maps').delete(mapID);
        });
    }

    getMap(mapID: string): Promise<StoredMap>{
        const transaction = this._db.transaction(['maps'], 'readonly');
        return new Promise<any>( (resolve, reject) => {
            const request = transaction.objectStore('maps').get(mapID);
            request.onerror = (event) => {
                console.log('error', event);
                reject('cannot get map');
            };
            request.onsuccess = (event) => {
                const map = request.result as StoredMap;
                if ( map === null ) {
                    reject(`map ${mapID} not found`);
                    return;
                }
                resolve(map);
            };
        });
    }

    // The atomic way of m = getMap(); m[layerType] = data; saveMap(m);
    saveMapLayer(mapID: string, layerType: LayerType, data: any): Promise<StoredMap> {
        return new Promise( (resolve, reject) => {
            const transaction = this._db.transaction(['maps'], 'readwrite');
            transaction.onerror = (event) => {
                console.log('transaction error', event);
                reject('cannot save map layer');
            }
            const os = transaction.objectStore('maps');
            const request = os.get(mapID); 
            request.onerror = (event) => {
                console.log('error', event);
                reject('cannot get map');
            };
            request.onsuccess = (event) => {
                const mm = request.result;
                mm[layerType] = data;
                const updateReq = os.put(mm);
                updateReq.onerror =  (event) => {
                    console.log('update error', event);
                    reject('cannot store map layer');
                };
                updateReq.onsuccess = (event) => {
                    resolve(mm);
                };
            };
        });        
    }
}
