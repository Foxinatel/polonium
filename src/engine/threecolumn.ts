// the famous three column layout

import { BiMap } from "mnemonist";
import { printDebug } from "../util";
import * as Engine from "./common";

class Container {
    client: KWin.AbstractClient;
    constructor(client: KWin.AbstractClient) {
        this.client = client;
    }
}

export class TilingEngine implements Engine.TilingEngine {
    columns = [new Array<Container>(), new Array<Container>(), new Array<Container>()];
    leftSize: number = 0.25;
    rightSize: number = 0.25;
    nodeMap = new BiMap<Container, KWin.Tile>();
    buildLayout(rootTile: KWin.Tile): boolean {
        // setup
        let leftTile: KWin.Tile | undefined;
        let rightTile: KWin.Tile | undefined;
        let centerTile: KWin.Tile | undefined;
        // there should always be at least one thing in the center
        if (this.columns[1].length == 0) {
            return true;
        }
        if (this.columns[0].length == 0 && this.columns[2].length == 0) {
            // only center
            centerTile = rootTile;
        } else if (this.columns[0].length == 0 && this.columns[2].length != 0) {
            // center and right
            rootTile.split(1);
            rootTile.tiles[1].relativeGeometry.width = this.rightSize;
            rootTile.tiles[0].relativeGeometry.width = 1 - this.rightSize;
            centerTile = rootTile.tiles[0];
            rightTile = rootTile.tiles[1];
        } else if (this.columns[0].length != 0 && this.columns[2].length == 0) {
            // center and left
            rootTile.split(1);
            rootTile.tiles[0].relativeGeometry.width = this.leftSize;
            rootTile.tiles[1].relativeGeometry.width = 1 - this.leftSize;
            centerTile = rootTile.tiles[1];
            leftTile = rootTile.tiles[0];
        } else if (this.columns[0].length != 0 && this.columns[2].length != 0) {
            // all columns
            rootTile.split(1);
            rootTile.tiles[1].split(1);
            rootTile.tiles[0].relativeGeometry.width = this.leftSize;
            rootTile.tiles[2].relativeGeometry.width = this.rightSize;
            rootTile.tiles[1].relativeGeometry.width = 1 - this.leftSize - this.rightSize;
            centerTile = rootTile.tiles[1];
            leftTile = rootTile.tiles[0];
            rightTile = rootTile.tiles[2];
        }
        if (leftTile != undefined) {
            let splitTile = leftTile;
            const left = this.columns[0];
            for (let i = 0; i < left.length; i += 1) {
                let container = left[i];
                // set the size if not the last one
                if (i != left.length - 1) {
                    splitTile.split(2);
                    leftTile.tiles[i].relativeGeometry.height = 1/left.length;
                    this.nodeMap.set(container, leftTile.tiles[i]);
                    splitTile = leftTile.tiles[i+1];
                } else {
                    this.nodeMap.set(container, splitTile);
                }
            }
        }
        if (rightTile != undefined) {
            let splitTile = rightTile;
            const right = this.columns[2];
            for (let i = 0; i < right.length; i += 1) {
                let container = right[i];
                // set the size if not the last one
                if (i != right.length - 1) {
                    splitTile.split(2);
                    rightTile.tiles[i].relativeGeometry.height = 1/right.length;
                    this.nodeMap.set(container, rightTile.tiles[i]);
                    splitTile = rightTile.tiles[i+1];
                } else {
                    this.nodeMap.set(container, splitTile);
                }
            }
        }
        if (centerTile != undefined) {
            let splitTile = centerTile;
            const center = this.columns[1];
            for (let i = 0; i < center.length; i += 1) {
                let container = center[i];
                // set the size if not the last one
                if (i != center.length - 1) {
                    splitTile.split(2);
                    centerTile.tiles[i].relativeGeometry.height = 1/center.length;
                    this.nodeMap.set(container, centerTile.tiles[i]);
                    splitTile = centerTile.tiles[i+1];
                } else {
                    this.nodeMap.set(container, splitTile);
                }
            }
        }
        return true;
    }
    
    updateTiles(rootTile: KWin.RootTile): boolean {
        if (this.columns[0].length == 0 && this.columns[2].length != 0) {
            this.rightSize = rootTile.tiles[1].relativeGeometry.width;
        } else if (this.columns[0].length != 0 && this.columns[2].length == 0) {
            this.leftSize = rootTile.tiles[0].relativeGeometry.width;
        } else if (this.columns[0].length != 0 && this.columns[2].length != 0) {
            this.rightSize = rootTile.tiles[2].relativeGeometry.width;
            this.leftSize = rootTile.tiles[0].relativeGeometry.width;
        }
        return true;
    }
    
    resizeTile(tile: KWin.Tile, direction: Engine.Direction, amount: number): boolean {
        // only resize left/right
        if (direction.primary) return false;
        const container = this.nodeMap.inverse.get(tile);
        if (container == null) return false;
        // left
        if (this.columns[0].includes(container)) {
            if (direction.right) {
                this.leftSize += amount;
            } else {
                this.leftSize -= amount;
            }
        } else if (this.columns[1].includes(container)) {
            if (direction.right) {
                this.rightSize -= amount;
            } else {
                this.leftSize -= amount;
            }
        } else if (this.columns[2].includes(container)) {
            if (direction.right) {
                this.rightSize -= amount;
            } else {
                this.rightSize += amount;
            }
        }
        while ((this.rightSize + this.leftSize) > 0.69) { // nice
            if (this.rightSize > this.leftSize) {
                this.rightSize -= amount;
            } else {
                this.leftSize -= amount;
            }
        }
        while (this.rightSize < 0.15) {
            this.rightSize += amount;
        }
        while (this.leftSize < 0.15) {
            this.leftSize += amount;
        }
        printDebug(this.rightSize + "", true);
        printDebug(this.leftSize + "", true);
        return true;
    }

    placeClients(): Array<[KWin.AbstractClient, KWin.Tile]> {
        let ret: Array<[KWin.AbstractClient, KWin.Tile]> = new Array;
        for (const column of this.columns) {
            for (const container of column) {
                const tile = this.nodeMap.get(container);
                if (tile == undefined) {
                    printDebug("No tile found for container", true);
                    return ret;
                }
                ret.push([container.client, tile]);
            }
        }
        return ret;
    }

    addClient(client: KWin.AbstractClient): boolean {
        // center first, then right, then left
        if (this.columns[1].length == 0) {
            this.columns[1].push(new Container(client));
        } else if (this.columns[2].length <= this.columns[0].length) {
            this.columns[2].push(new Container(client));
        } else {
            this.columns[0].push(new Container(client));
        }
        return true;
    }

    putClientInTile(client: KWin.AbstractClient, tile: KWin.Tile, direction?: Engine.Direction): boolean {
        const container = this.nodeMap.inverse.get(tile);
        const newContainer = new Container(client);
        if (container == undefined) {
            printDebug("No container found for tile", true);
            return false;
        }
        let array: Array<Container> | undefined;
        for (const column of this.columns) {
            if (column.includes(container)) {
                array = column;
                break;
            }
        }
        if (array == undefined) {
            printDebug("Container not registered", true);
            return false;
        }
        // special behavior for center if there are no windows present on the sides
        if (array == this.columns[1]) {
            if (direction == undefined) {
                array.splice(array.indexOf(container), 0, newContainer);
            } else {
                if (direction.right && this.columns[2].length == 0) {
                    this.columns[2].push(newContainer);
                } else if (!direction.right && this.columns[0].length == 0) {
                    this.columns[0].push(newContainer);
                } else {
                    if (direction.above) {
                        array.splice(array.indexOf(container), 0, newContainer);
                    } else {
                        array.splice(array.indexOf(container) + 1, 0, newContainer);
                    }
                }
            }
        } else {
            if (direction == undefined) {
                array.splice(array.indexOf(container), 0, newContainer);
            } else {
                if (direction.above) {
                    array.splice(array.indexOf(container), 0, newContainer);
                } else {
                    array.splice(array.indexOf(container) + 1, 0, newContainer);
                }
            }
        }
        return true;
    }

    swapTiles(tileA: KWin.Tile, tileB: KWin.Tile): boolean {
        const containerA = this.nodeMap.inverse.get(tileA);
        const containerB = this.nodeMap.inverse.get(tileB);
        if (containerA == null || containerB == null) {
            printDebug("No container found for tile", true);
            return false;
        }
        const tmpclient = containerA.client;
        containerA.client = containerB.client;
        containerB.client = tmpclient;
        return true;
    }

    clientOfTile(tile: KWin.Tile): KWin.AbstractClient | null {
        const container = this.nodeMap.inverse.get(tile);
        if (container == undefined) {
            printDebug("No container found for tile", true);
            return null;
        }
        return container.client;
    }

    removeClient(client: KWin.AbstractClient): boolean {
        for (let i = 0; i < this.columns.length; i += 1) {
            let column = this.columns[i];
            for (let j = 0; j < column.length; j += 1) {
                if (column[j].client == client) {
                    column.splice(j, 1);
                    // if center column and other windows exist on other columns move one in from the side with the most
                    if (this.columns[1].length == 0) {
                        // get the column with the least windows
                        let columnToRemove = (this.columns[0].length > this.columns[2].length) ? this.columns[0] : this.columns[2];
                        // if no more windows, return
                        if (columnToRemove.length == 0) {
                            return true;
                        }
                        const container = columnToRemove[columnToRemove.length - 1];
                        column.push(container);
                        columnToRemove.splice(columnToRemove.length - 1, 1);
                    }
                    return true;
                }
            }
        }
        return false;
    }
}
