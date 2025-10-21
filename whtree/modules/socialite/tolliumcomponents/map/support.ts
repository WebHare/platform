import * as dompack from "@webhare/dompack";
import { getTid } from "@webhare/gettid";
import { createTolliumImage, getTheme, runSimpleScreen, tolliumActionEnabler, type Host } from "@webhare/tollium-iframe-api";
import "@webhare/tollium-iframe-api/styling/tollium.css";

// The default line color for shapes added to the map
export const defaultShapeColor = getTheme().colorAccent;

// A few basic lat/lng types
export type LatLng = { lat: number; lng: number };
export type LatLngBounds = { sw: LatLng; ne: LatLng };

// The types of overlay
export type MapOverlayTypes = "marker" | "polyline" | "polygon";
// Overlay rowkeys are either strings or numbers
export type MapOverlayRowkey = string | number;

// An overlay to show on the map
export type MapOverlay<T extends MapOverlayTypes> = {
  rowkey: MapOverlayRowkey;
  flags: Record<string, boolean>;
} & (
    T extends "marker" ? {
      type: "marker";
      lat: number;
      lng: number;
      icon: string;
      hint: string;
      infohtml: string;
      moveable: boolean;
      selectable: boolean;
    } :
    T extends "polyline" ? {
      type: "polyline";
      latlngs: LatLng[];
      outlinewidth: number;
      outlinecolor: string;
      outlineopacity: number; // 0-100
      selectable: boolean;
    } :
    T extends "polygon" ? {
      type: "polygon";
      latlngs: LatLng[];
      outlinewidth: number;
      outlinecolor: string;
      outlineopacity: number; // 0-100
      fillcolor: string;
      fillopacity: number; // 0-100
      selectable: boolean;
    } : never
  );

// An overlay icon
export type MapIcon = {
  name: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  popupX: number;
  popupY: number;
  icon: string;
  width: number;
  height: number;
};

// The supported map types (only for Google Map)
type MapTypes = "map" | "satellite" | "hybrid" | "physical";

// The settings that can be updated after the map is initialized
export type UpdatableMapSettings = {
  newContextMenu?: string;
  selectContextMenu?: string;
  mapType?: MapTypes;
  center?: LatLng;
  zoom?: number;
  restrictTo?: LatLngBounds | null;
  moveable?: boolean;
  showControls?: boolean;
  icons?: MapIcon[];
  overlays?: Array<MapOverlay<MapOverlayTypes>>;
  clusterOverlays?: boolean;
  clusterIcon?: string;
  clusterRadius?: number;
};

// We currently sypport either Leaflet (OpenStreetMap) or Google Map
export type MapProviders = "leaflet" | "googlemap";

// The initial map settings
export type MapSettings<T extends MapProviders> = UpdatableMapSettings & {
  language?: string;
} & (
    T extends "leaflet" ? { provider: "leaflet" } :
    T extends "googlemap" ? { provider: "googlemap"; key: string } :
    never
  );

// For communicating with the backend code
export interface MapHostProtocol {
  map_click: { pos: LatLng };
  map_dblclick: { pos: LatLng };
  map_rightclick: { pos: LatLng };
  map_moveend: { center: LatLng; bounds: LatLngBounds };
  map_zoomend: { zoom: number };
  overlay_click: { rowkeys: MapOverlayRowkey[] };
  overlay_rightclick: { rowkey: MapOverlayRowkey };
  overlay_dragend: { rowkeys: MapOverlayRowkey[]; pos: LatLng };
}

// The base class for map implementations
export abstract class MapObject {
  // The host communicating with the backend code
  protected host: Host<MapHostProtocol>;
  // The promise that is resolved after the map is initialized
  protected initPromise?: Promise<void>;

  // Internal property storage
  private _newContextMenu?: string;
  private _selectContextMenu?: string;
  private _selection: Set<MapOverlayRowkey> = new Set();

  private overlayFlags: Array<{ rowkey: MapOverlayRowkey; flags: Record<string, boolean> }> = [];

  // The currently selected overlay(s)
  get selection() {
    return [...this._selection.keys()];
  }
  set selection(rowkeys: MapOverlayRowkey[]) {
    this._selection.clear();
    for (const rowkey of rowkeys)
      this._selection.add(rowkey);

    const selection = this.overlayFlags
      .filter(_ => this._selection.has(_.rowkey))
      .map(_ => ({ ..._.flags })) ?? [];
    tolliumActionEnabler(selection);
  }

  // The name of the context menu to show if nothing is selected
  get newContextMenu() {
    return this._newContextMenu;
  }

  // The name of the context menu to show if overlays are selected
  get selectContextMenu() {
    return this._selectContextMenu;
  }

  // For internal use
  constructor(host: Host<MapHostProtocol>) {
    this.host = host;
  }

  // For internal use
  async update(settings: UpdatableMapSettings) {
    // Wait for the map to be initialized and update the settings
    await this.initPromise;
    await this.updateSettings(settings);
  }

  // Call this function within updateSettings to update the (map-agnostic) Tollium settings
  protected updateTolliumSettings(settings: UpdatableMapSettings) {
    if (settings.newContextMenu !== undefined)
      this._newContextMenu = settings.newContextMenu;
    if (settings.selectContextMenu !== undefined)
      this._selectContextMenu = settings.selectContextMenu;

    if (settings.overlays !== undefined)
      this.overlayFlags = settings.overlays.map(_ => ({ rowkey: _.rowkey, flags: _.flags }));
  }

  static getCurrentLocation(): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((position: GeolocationPosition) => {
        resolve(position);
      }, (error: GeolocationPositionError) => {
        switch (error.code) {
          case GeolocationPositionError.PERMISSION_DENIED: {
            void runSimpleScreen("warning", getTid("socialite:tolliumcomponents.map.error-permission-denied"));
            break;
          }
          case GeolocationPositionError.POSITION_UNAVAILABLE: {
            void runSimpleScreen("warning", getTid("socialite:tolliumcomponents.map.error-position-unavailable"));
            break;
          }
          case GeolocationPositionError.TIMEOUT: {
            void runSimpleScreen("warning", getTid("socialite:tolliumcomponents.map.error-timeout"));
            break;
          }
          default: {
            void runSimpleScreen("warning", getTid("socialite:tolliumcomponents.map.error-unknown"));
            break;
          }
        }
        resolve(null);
      }, {
        enableHighAccuracy: true,
        timeout: 30 * 1000, // Wait at most 30 seconds
        maximumAge: 8 * 60 * 60 * 1000, // Cache for 8 hours
      });
    });
  }

  // Override to initialize the map
  abstract init(_mapDiv: HTMLElement, settings: MapSettings<MapProviders>): Promise<void> | void;
  // Override to deinitialize the map
  abstract deinit(): void;
  // Override to update map-specific settings
  abstract updateSettings(settings: UpdatableMapSettings): Promise<void> | void;
  // Override to update the viewport
  abstract setViewport(viewport: LatLngBounds): Promise<void> | void;
}

export type ButtonEvent = dompack.DocEvent<MouseEvent, HTMLImageElement, HTMLElement>;

export abstract class NavControlObject {
  protected async createButtons() {
    // Create a container for our buttons
    const node = document.createElement("div");
    node.id = "navcontrol";
    // Create our buttons buttons and add them to the container
    await this.createButton(node, "goup", getTid("socialite:tolliumcomponents.map.goup"), (event: ButtonEvent) => this.panUp(event));
    node.appendChild(document.createElement("br"));
    await this.createButton(node, "goleft", getTid("socialite:tolliumcomponents.map.goleft"), (event: ButtonEvent) => this.panLeft(event));
    await this.createButton(node, "goright", getTid("socialite:tolliumcomponents.map.goright"), (event: ButtonEvent) => this.panRight(event));
    node.appendChild(document.createElement("br"));
    await this.createButton(node, "godown", getTid("socialite:tolliumcomponents.map.godown"), (event: ButtonEvent) => this.panDown(event));
    if ("geolocation" in navigator) {
      node.appendChild(document.createElement("br"));
      await this.createButton(node, "center", getTid("socialite:tolliumcomponents.map.center"), async (event: ButtonEvent) => await this.panCenter(event));
    }
    node.appendChild(document.createElement("br"));
    await this.createButton(node, "zoomin", getTid("socialite:tolliumcomponents.map.zoomin"), (event: ButtonEvent) => this.zoomIn(event));
    await this.createButton(node, "zoomout", getTid("socialite:tolliumcomponents.map.zoomout"), (event: ButtonEvent) => this.zoomOut(event));
    return node;
  }

  private async createButton(node: HTMLElement, buttonimage: string, title: string, callback: (event: ButtonEvent) => Promise<void> | void) {
    const button = document.createElement("img");
    button.className = buttonimage;
    const img = await createTolliumImage("tollium:maps/" + buttonimage, 24, 24);
    button.src = img.src;
    button.width = img.width;
    button.height = img.height;
    button.title = title;
    button.role = "button";
    dompack.addDocEventListener(button, "click", async event => {
      event.stopPropagation();
      event.preventDefault();
      if (!button.classList.contains("disabled"))
        await callback(event);
    });
    // Prevent the map from zooming in when double clicking a navigation button
    button.addEventListener("doubleclick", event => event.stopPropagation());
    node.appendChild(button);
    return button;
  }

  protected setButtonEnabled(button: HTMLImageElement, enabled: boolean) {
    button.classList.toggle("disabled", !enabled);
  }

  abstract panUp(event: ButtonEvent): Promise<void> | void;
  abstract panDown(event: ButtonEvent): Promise<void> | void;
  abstract panLeft(event: ButtonEvent): Promise<void> | void;
  abstract panRight(event: ButtonEvent): Promise<void> | void;
  abstract panCenter(event: ButtonEvent): Promise<void> | void;
  abstract zoomIn(event: ButtonEvent): Promise<void> | void;
  abstract zoomOut(event: ButtonEvent): Promise<void> | void;
}
