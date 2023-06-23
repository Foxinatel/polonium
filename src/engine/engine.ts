import { type TilingEngine, type Direction } from "./common";
import { config, printDebug } from "../util";
import { workspace, showDialog } from "../index";

// engines and engine enum
import * as BTree from "./btree";
import * as Half from "./half";
import * as ThreeColumn from "./threecolumn";
import * as Kwin from "./kwin";

export enum EngineTypes {
    BTree = 0,
    Half,
    ThreeColumn,
    Kwin,
    // this enum member is used to loop the enum when iterating it
    _loop,
}

export class Desktop {
    screen: number;
    activity: string;
    desktop: number;
    toString(): string {
        return `(${this.screen}, ${this.activity}, ${this.desktop})`;
    }

    constructor(screen?: number, activity?: string, desktop?: number) {
        if (screen === undefined || activity === undefined || desktop === undefined) {
            this.screen = workspace.activeScreen;
            this.activity = workspace.currentActivity;
            this.desktop = workspace.currentDesktop;
        } else {
            this.screen = screen;
            this.activity = activity;
            this.desktop = desktop;
        }
    }
}

function engineForEnum(engine: EngineTypes): TilingEngine | undefined {
    switch (engine) {
        case EngineTypes.BTree:
            return new BTree.TilingEngine();
        case EngineTypes.Half:
            return new Half.TilingEngine();
        case EngineTypes.ThreeColumn:
            return new ThreeColumn.TilingEngine();
        case EngineTypes.Kwin:
            return new Kwin.TilingEngine();
        default:
            return undefined;
    }
}

export class EngineManager {
    engineTypes = new Map<string, EngineTypes>();
    engines = new Map<string, TilingEngine>();
    layoutBuilding: boolean = false;
    tileRebuildTimers = new Map<KWin.RootTile, QTimer>();

    createNewEngine(desktop: Desktop): TilingEngine | undefined {
        this.engineTypes.set(desktop.toString(), config.defaultEngine);
        const engine = engineForEnum(config.defaultEngine);
        if (engine === undefined) {
            printDebug(`Could not create default engine for desktop ${desktop}`, true);
            return undefined;
        }
        this.engines.set(desktop.toString(), engine);
        return engine;
    }

    cycleEngine(desktop: Desktop): boolean {
        let engineType = this.engineTypes.get(desktop.toString());
        if (engineType === undefined) {
            printDebug(`No engine found for desktop ${desktop}`, true);
            return false;
        }
        engineType += 1;
        engineType %= EngineTypes._loop;
        printDebug(`Setting engine for ${desktop} to engine ${EngineTypes[engineType]}`, false);
        this.engineTypes.set(desktop.toString(), engineType);
        const engine = engineForEnum(engineType);
        if (engine == null) {
            printDebug(`Failed to cycle engine for desktop ${desktop}`, true);
            return false;
        }
        this.engines.set(desktop.toString(), engine);
        showDialog(EngineTypes[engineType]);
        return true;
    }

    buildLayout(rootTile: KWin.RootTile, desktop: Desktop): boolean {
        // disconnect layout modified signal temporarily to stop them from interfering
        this.layoutBuilding = true;
        printDebug(`Building layout for desktop ${desktop}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        // wipe rootTile clean
        while (rootTile.tiles.length > 0) {
            rootTile.tiles[0].remove();
        }
        if (engine === undefined) return false;
        const ret = engine.buildLayout(rootTile);
        this.layoutBuilding = false;
        if (!rootTile.connected) {
            rootTile.connected = true;
            rootTile.layoutModified.connect(this.updateTilesSignal.bind(this, rootTile));
        }
        return ret;
    }

    private updateTilesSignal(rootTile: KWin.RootTile): void {
        // do not execute while layout is building
        if (this.layoutBuilding) return;
        let timer = this.tileRebuildTimers.get(rootTile);
        if (timer === undefined) {
            printDebug("Creating tile update timer", false);
            timer = new QTimer();
            this.tileRebuildTimers.set(rootTile, timer);
            timer.singleShot = true;
            timer.timeout.connect(this.updateTiles.bind(this, rootTile));
        }
        timer.start(config.timerDelay);
    }

    updateTiles(rootTile: KWin.RootTile): boolean {
        // do not execute while layout is building
        if (this.layoutBuilding) return true;
        // should work as you can only modify tiles on the current desktop
        const desktop = new Desktop();
        printDebug(`Updating tiles for desktop ${desktop}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return false;
        return engine.updateTiles(rootTile);
    }

    resizeTile(tile: KWin.Tile, direction: Direction, amount: number): boolean {
        // set layoutBuilding to prevent updateTiles from being called
        this.layoutBuilding = true;
        const desktop = new Desktop();
        printDebug(`Resizing tile in direction ${direction} by ${amount} of screen space on desktop ${desktop}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return false;
        const ret = engine.resizeTile(tile, direction, amount);
        this.layoutBuilding = false;
        return ret;
    }

    placeClients(desktop: Desktop): Array<[KWin.AbstractClient, KWin.Tile | null]> {
        printDebug(`Placing clients for desktop ${desktop}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return [];
        return engine.placeClients();
    }

    addClient(client: KWin.AbstractClient, optionalDesktop?: Desktop): boolean {
        const desktops = new Array<Desktop>();
        if (!optionalDesktop) {
            if (client.desktop === -1) {
                for (let i = 0; i < workspace.desktops; i += 1) {
                    for (const activity of client.activities) {
                        const desktop = new Desktop(client.screen, activity, i);
                        desktops.push(desktop);
                    }
                }
            } else {
                for (const activity of client.activities) {
                    const desktop = new Desktop(client.screen, activity, client.desktop);
                    desktops.push(desktop);
                }
            }
        } else {
            desktops.push(optionalDesktop);
        }
        for (const desktop of desktops) {
            printDebug(`Adding ${client.resourceClass} to desktop ${desktop}`, false);
            const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
            if (engine === undefined || !engine.addClient(client)) return false;
        }
        return true;
    }

    updateClientDesktop(client: KWin.AbstractClient, oldDesktops: Desktop[]): boolean {
        const newDesktops = new Array<Desktop>();
        if (client.desktop === -1) {
            for (let i = 0; i < workspace.desktops; i += 1) {
                for (const activity of client.activities) {
                    const desktop = new Desktop(client.screen, activity, i);
                    newDesktops.push(desktop);
                }
            }
        } else {
            for (const activity of client.activities) {
                const desktop = new Desktop(client.screen, activity, client.desktop);
                newDesktops.push(desktop);
            }
        }
        // have to do this because of js object equality
        const newDesktopsStrings = newDesktops.map(x => x.toString());
        const oldDesktopsStrings = oldDesktops.map(x => x.toString());
        for (const desktop of oldDesktops) {
            // do not retile on desktops that the window is already on
            if (newDesktopsStrings.includes(desktop.toString())) continue;
            if (!this.removeClient(client, desktop)) {
                return false;
            }
        }
        for (const desktop of newDesktops) {
            // do not readd client to windows it is on
            if (oldDesktopsStrings.includes(desktop.toString())) continue;
            if (!this.addClient(client, desktop)) {
                return false;
            }
        }
        return true;
    }

    putClientInTile(client: KWin.AbstractClient, tile: KWin.Tile, direction?: Direction): boolean {
        const desktop = new Desktop();
        printDebug(`Placing ${client.resourceClass} in ${tile}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return false;
        return engine.putClientInTile(client, tile, direction);
    }

    clientOfTile(tile: KWin.Tile): KWin.AbstractClient | null {
        const desktop = new Desktop();
        printDebug(`Getting client of ${tile}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return null;
        return engine.clientOfTile(tile);
    }

    swapTiles(tileA: KWin.Tile, tileB: KWin.Tile): boolean {
        const desktop = new Desktop();
        printDebug(`Swapping clients of ${tileA} and ${tileB}`, false);
        const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
        if (engine === undefined) return false;
        return engine.swapTiles(tileA, tileB);
    }

    removeClient(client: KWin.AbstractClient, optionalDesktop?: Desktop): boolean {
        const desktops = new Array<Desktop>();
        if (!optionalDesktop) {
            if (client.desktop === -1) {
                for (let i = 0; i < workspace.desktops; i += 1) {
                    for (const activity of client.activities) {
                        const desktop = new Desktop(client.screen, activity, i);
                        desktops.push(desktop);
                    }
                }
            } else {
                for (const activity of client.activities) {
                    const desktop = new Desktop(client.screen, activity, client.desktop);
                    desktops.push(desktop);
                }
            }
        } else {
            desktops.push(optionalDesktop);
        }
        for (const desktop of desktops) {
            printDebug(`Removing ${client.resourceClass} from desktop ${desktop}`, false);
            const engine = this.engines.get(desktop.toString()) ?? this.createNewEngine(desktop);
            if (engine === undefined || !engine.removeClient(client)) return false;
        }
        return true;
    }
}
