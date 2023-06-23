// normal kwin tiling
import { BiMap } from "mnemonist";
import { printDebug } from "../util";
import type * as Engine from "./common";

// look familiar?
class Tile {
    tiles = new Array<Tile>();
    windows = new Array<KWin.AbstractClient>();
    // change this to be any because my qt.qrect definition doesnt cover everything
    relativeGeometry: Qt.QRect | null;
    parent: Tile | null;
    padding: number = 4;
    layoutDirection: number;
    constructor(parent: Tile | null, relativeGeometry: Qt.QRect | null, layoutDirection: number) {
        this.layoutDirection = layoutDirection;
        // rootTile
        if (parent == null || relativeGeometry == null) {
            this.parent = null;
            this.relativeGeometry = null;
            return;
        }
        this.parent = parent;
        this.relativeGeometry = {
            x: relativeGeometry.x,
            y: relativeGeometry.y,
            width: relativeGeometry.width,
            height: relativeGeometry.height
        };
        parent.tiles.push(this);
    }
}
class RootTile extends Tile {
    parent: null = null;
    relativeGeometry: null = null;
    constructor(layoutDirection: number) {
        super(null, null, layoutDirection);
    }
}

export class TilingEngine implements Engine.TilingEngine {
    fakeRootTile: RootTile = new RootTile(1);
    untiledClients = new Array<KWin.AbstractClient>();
    tileMap = new BiMap<Tile, KWin.Tile>();
    buildLayout(rootTile: KWin.RootTile): boolean {
        this.tileMap.clear();
        this.tileMap.set(this.fakeRootTile, rootTile);
        let stack: Tile[] = [this.fakeRootTile];
        let stackNext = new Array<Tile>();
        while (stack.length != 0) {
            for (const fakeTile of stack) {
                const realTile = this.tileMap.get(fakeTile);
                if (realTile == undefined) {
                    printDebug("Could not find tile", true);
                    return false;
                }
                let splitTile = realTile;
                for (let i = 1; i < fakeTile.tiles.length; i += 1) {
                    splitTile.split(fakeTile.layoutDirection);
                    splitTile = realTile.tiles[i];
                }
                for (let i = 0; i < fakeTile.tiles.length; i += 1) {
                    // have to set all properties individually for reasons
                    this.tileMap.set(fakeTile.tiles[i], realTile.tiles[i]);
                    stackNext.push(fakeTile.tiles[i]);
                }
                const geometry = fakeTile.relativeGeometry;
                if (geometry != null) {
                    realTile.relativeGeometry.x = geometry.x;
                    realTile.relativeGeometry.y = geometry.y;
                    realTile.relativeGeometry.width = geometry.width;
                    realTile.relativeGeometry.height = geometry.height;
                }
            }
            stack = stackNext;
            stackNext = [];
        }
        return true;
    }

    updateTiles(rootTile: KWin.RootTile): boolean {
        this.tileMap.clear();
        this.fakeRootTile = new RootTile(rootTile.layoutDirection);
        this.tileMap.set(this.fakeRootTile, rootTile);
        let stack: KWin.Tile[] = [rootTile];
        let stackNext = new Array<KWin.Tile>();
        while (stack.length > 0) {
            for (const realTile of stack) {
                const fakeTile = this.tileMap.inverse.get(realTile);
                if (fakeTile == undefined) {
                    printDebug("Could not find tile", true);
                    return false;
                }
                for (const tile of realTile.tiles) {
                    const newTile = new Tile(fakeTile, tile.relativeGeometry, tile.layoutDirection);
                    for (const client of tile.windows) {
                        newTile.windows.push(client);
                    }
                    this.tileMap.set(newTile, tile);
                    stackNext.push(tile);
                }
            }
            stack = stackNext;
            stackNext = [];
        }
        return true;
    }

    // may add in the future
    resizeTile(_tile: KWin.Tile, _direction: Engine.Direction, _amount: number): boolean {
        return true;
    }

    placeClients(): Array<[KWin.AbstractClient, KWin.Tile | null]> {
        const ret = new Array<[KWin.AbstractClient, KWin.Tile | null]>();
        for (const fakeTile of this.tileMap.keys()) {
            for (const client of fakeTile.windows) {
                ret.push([client, this.tileMap.get(fakeTile)!]);
            }
        }
        for (const client of this.untiledClients) {
            ret.push([client, null]);
        }
        return ret;
    }

    // user tiles this if they want
    addClient(client: KWin.AbstractClient): boolean {
        this.untiledClients.push(client);
        return true;
    }

    putClientInTile(client: KWin.AbstractClient, tile: KWin.Tile): boolean {
        const fakeTile = this.tileMap.inverse.get(tile);
        if (fakeTile == undefined) {
            printDebug("Could not find tile", true);
            return false;
        }
        if (this.untiledClients.includes(client)) {
            this.untiledClients.splice(this.untiledClients.indexOf(client), 1);
        }
        fakeTile.windows.push(client);
        return true;
    }

    clientOfTile(tile: KWin.Tile): KWin.AbstractClient | null {
        if (this.tileMap.inverse.has(tile)) {
            const client = this.tileMap.inverse.get(tile)!.windows[0];
            if (client == undefined) {
                return null;
            } else {
                return client;
            }
        } else {
            return null;
        }
    }

    swapTiles(tileA: KWin.Tile, tileB: KWin.Tile): boolean {
        const fakeTileA = this.tileMap.inverse.get(tileA);
        const fakeTileB = this.tileMap.inverse.get(tileB);
        if (fakeTileA == undefined || fakeTileB == undefined) {
            printDebug("Could not find tiles", true);
            return false;
        }
        const tmparray = fakeTileA.windows;
        fakeTileA.windows = fakeTileB.windows;
        fakeTileB.windows = tmparray;
        return true;
    }

    removeClient(client: KWin.AbstractClient): boolean {
        if (this.untiledClients.includes(client)) {
            this.untiledClients.splice(this.untiledClients.indexOf(client), 1);
            return true;
        }
        for (const fakeTile of this.tileMap.keys()) {
            if (fakeTile.windows.includes(client)) {
                fakeTile.windows.splice(fakeTile.windows.indexOf(client), 1);
                return true;
            }
        }
        // only reach here if client is not found
        return true;
    }
}
