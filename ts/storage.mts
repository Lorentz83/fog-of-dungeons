import { PositionedMarker, newID } from "./api.mjs"

export type LayerType = 'base' | 'fog' | 'markers';

interface StoredMapBuilder {
    title: string;
    base: Blob;
    fog: Blob;
    markers: PositionedMarker[];
}

export class StoredMap {
    id: string;
    title: string;
    base: Blob;
    fog: Blob;
    markers: PositionedMarker[];

    constructor(b: StoredMapBuilder) {
        this.id = newID();
        this.title = b.title;
        this.base = b.base;
        this.fog = b.fog;
        this.markers = b.markers;
    }
}

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
