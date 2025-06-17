import { Loader } from "@googlemaps/js-api-loader";
import { type Cluster, MarkerClusterer, type SuperClusterOptions } from "@googlemaps/markerclusterer";
import { createTolliumImage, requestedBrowserContextMenu, showTolliumContextMenu } from "@webhare/tollium-iframe-api";
import { theme } from "@webhare/tollium-iframe-api/styling";
import {
  type ButtonEvent,
  defaultShapeColor,
  type LatLngBounds,
  type MapIcon,
  MapObject,
  type MapOverlay,
  type MapOverlayRowkey,
  type MapOverlayTypes,
  type MapSettings,
  NavControlObject,
  type UpdatableMapSettings,
} from "./support";

// Note: For the time being, we'll be using the (deprecated) legacy Marker, so we don't have to register a Map ID which is
//       needed for the new AdvancedMarkerElement.

let loader: Loader | undefined = undefined;

interface InfoWindow extends google.maps.OverlayView {
  get overlay(): MapOverlayRowkey | null;
  open(position: google.maps.LatLng, overlay: MapOverlayRowkey, content: string, pixelOffset?: google.maps.Size): void;
  close(): void;
}

export class GoogleMap extends MapObject {
  // Our map object
  private map?: google.maps.Map;
  // The navigation control on the top left
  private navControl?: NavControl;
  // Our custom popup window
  private infoWindow?: InfoWindow;
  // The available icons
  private icons: Map<string, { icon: google.maps.Icon; pixelOffset: google.maps.Size }> = new Map();
  // The overlays to show on the map
  private overlays: Map<MapOverlayRowkey, google.maps.Marker | google.maps.Polyline | google.maps.Polygon> = new Map(); // See note at top about the deprecation warning
  // The overlay clusterer
  private clusterer?: MarkerClusterer;

  // Internal property storage
  private _showControls?: boolean;
  private _clusterOverlays = false;
  private _clusterIcon = "";
  private _clusterRadius = 100;

  get showControls() {
    return Boolean(this._showControls);
  }

  set showControls(showControls: boolean) {
    void this.navControl?.control.then(node => {
      if (!node || showControls === this._showControls)
        return;
      this._showControls = showControls;
      if (this._showControls)
        this.map!.controls[google.maps.ControlPosition.TOP_LEFT].push(node);
      else
        node.remove();
    });
  }

  get clusterOverlays() {
    return this._clusterOverlays;
  }

  set clusterOverlays(clusterOverlays: boolean) {
    if (clusterOverlays !== this._clusterOverlays) {
      this._clusterOverlays = clusterOverlays;
      if (this.clusterOverlays) {
        // Make sure we have a MarkerClusterer
        if (!this.clusterer)
          this.clusterer = new MarkerClusterer({
            map: this.map,
            renderer: {
              render: (cluster: Cluster) => {
                // Render a cluster icon
                const icon = this.icons.get(this.clusterIcon)?.icon;
                return new google.maps.Marker({ // See note at top about the deprecation warning
                  position: cluster.position,
                  icon,
                  label: {
                    text: String(cluster.markers!.length),
                    fontFamily: theme.fontFamily,
                    fontSize: theme.fontSize + "px",
                    fontWeight: "bold",
                    color: "#ffffff",
                  },
                });
              },
            },
            algorithmOptions: {
              radius: this.clusterRadius,
            } as SuperClusterOptions,
          });
        // Move all markers to the marker clusterer
        this.clusterer.addMarkers([...this.overlays.values()].filter(_ => _ instanceof google.maps.Marker)); // See note at top about the deprecation warning
      } else if (this.clusterer) {
        // Remove all markers from the marker clusterer
        this.clusterer.clearMarkers();
        // Move all markers to the map
        for (const marker of [...this.overlays.values()].filter(_ => _ instanceof google.maps.Marker)) // See note at top about the deprecation warning
          marker.setMap(this.map!);
      }
    }
  }

  get clusterIcon() {
    return this._clusterIcon;
  }

  set clusterIcon(clusterIcon: string) {
    if (clusterIcon !== this._clusterIcon) {
      if (!this.icons.has(clusterIcon))
        throw new Error(`No such icon '${clusterIcon}'`);
      this._clusterIcon = clusterIcon;
      //FIXME: Update already rendered clusters?
    }
  }

  get clusterRadius() {
    return this._clusterRadius;
  }

  set clusterRadius(clusterRadius: number) {
    if (clusterRadius !== this._clusterRadius) {
      this._clusterRadius = clusterRadius;
      //FIXME: Update already rendered clusters?
    }
  }

  async init(mapDiv: HTMLElement, settings: MapSettings<"googlemap">) {
    // The initialization promise we'll resolve after we're fully initialized
    const { promise, resolve } = Promise.withResolvers<void>();
    this.initPromise = promise;

    // Initialize the Google Map loader
    if (!settings.key)
      throw new Error(`Google Map API key not set`);
    loader = loader ?? new Loader({
      apiKey: settings.key,
      version: "weekly",
      language: settings.language,
    });
    // Load the 'maps' library
    await loader.importLibrary("maps");

    // Initialize the map object
    this.map = new google.maps.Map(mapDiv, {
      disableDefaultUI: true,
      disableDoubleClickZoom: true,
      gestureHandling: "greedy",
    });

    this.map.addListener("click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onClick(event));
    this.map.addListener("dblclick", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onDblClick(event));
    this.map.addListener("center_changed", () => this.onCenterChanged());
    this.map.addListener("zoom_changed", () => this.onZoomChanged());
    // If the 'contextmenu' event is used, the context menu disappears after mouseup, so we'll use 'rightclick'
    // Note that this also means we cannot show the default browser context menu when ctrl+shift is pressed when right clicking...
    this.map.addListener("rightclick", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onContextMenu(event));

    // Create an info window popup
    this.infoWindow = createInfoWindow(this.map);

    // Add the navigation control
    this.navControl = new NavControl(this.map);

    // Wait for the map to be initialized
    await new Promise(loaded => this.map!.addListener("idle", loaded));
    // Do the initial settings update
    await this.updateSettings(settings);
    // The map is initialized
    resolve();
  }

  deinit() { }

  private onClick(event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    event.stop();

    this.selection = [];
    const pos = event.latLng;
    if (pos)
      this.host.post("map_click", { pos: { lat: pos.lat(), lng: pos.lng() } });
  }

  private onDblClick(event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    event.stop();
    this.selection = [];
    const pos = event.latLng;
    if (pos)
      this.host.post("map_dblclick", { pos: { lat: pos.lat(), lng: pos.lng() } });
  }

  private onOverlayClick(overlay: MapOverlay<MapOverlayTypes>, event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    event.stop();
    // If this overlay has 'infohtml' to show, open the info window
    if (overlay.type === "marker" && overlay.infohtml) {
      const marker = this.overlays.get(overlay.rowkey)! as google.maps.Marker; // See note at top about the deprecation warning
      const icon = this.icons.get(overlay.icon ?? "");
      let offset = icon?.pixelOffset; // The offset of the center of the popup relative to the top left corner
      if (offset) {
        const size = icon!.icon.size!;
        // Calculate what should be added to the popup position to make it relative to the bottom center (where Google Map
        // expects it to originate from)
        offset = new google.maps.Size(offset.width - (size.width / 2), offset.height - size.height);
      }
      this.infoWindow!.open(marker.getPosition()!, overlay.rowkey, overlay.infohtml, offset);
    }
    this.selection = [overlay.rowkey];
    this.host.post("overlay_click", { rowkeys: [overlay.rowkey] });
  }

  private onOverlayRightClick(overlay: MapOverlay<MapOverlayTypes>, event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    event.stop();
    this.selection = [overlay.rowkey];
    this.host.post("overlay_rightclick", { rowkey: overlay.rowkey });
    // Open the 'select' context menu
    if (event.domEvent instanceof MouseEvent && !requestedBrowserContextMenu(event.domEvent) && this.selectContextMenu) {
      const point = { x: event.domEvent.clientX, y: event.domEvent.clientY };
      showTolliumContextMenu(this.selectContextMenu, point);
    }
  }

  private onOverlayMove(overlay: MapOverlay<MapOverlayTypes>, event: google.maps.MapMouseEvent) {
    this.selection = [overlay.rowkey];
    const pos = event.latLng;
    if (pos)
      this.host.post("overlay_dragend", { rowkeys: [overlay.rowkey], pos: { lat: pos.lat(), lng: pos.lng() } });
  }

  private onCenterChanged() {
    const center = this.map?.getCenter();
    const bounds = this.map?.getBounds();
    if (center && bounds)
      this.host.post("map_moveend", {
        center: { lat: center.lat(), lng: center.lng() },
        bounds: {
          sw: { lat: bounds.getSouthWest().lat(), lng: bounds.getSouthWest().lng() },
          ne: { lat: bounds.getNorthEast().lat(), lng: bounds.getNorthEast().lng() },
        }
      });
  }

  private onZoomChanged() {
    const zoom = this.map?.getZoom();
    const bounds = this.map?.getBounds();
    if (zoom !== undefined && !isNaN(zoom) && bounds)
      this.host.post("map_zoomend", {
        zoom,
        bounds: {
          sw: { lat: bounds.getSouthWest().lat(), lng: bounds.getSouthWest().lng() },
          ne: { lat: bounds.getNorthEast().lat(), lng: bounds.getNorthEast().lng() },
        },
      });
  }

  private onContextMenu(event: google.maps.MapMouseEvent) {
    event.stop();
    this.selection = [];
    const pos = event.latLng;
    if (pos)
      this.host.post("map_rightclick", { pos: { lat: pos.lat(), lng: pos.lng() } });
    // Open the 'new' context menu
    if (event.domEvent instanceof MouseEvent && !requestedBrowserContextMenu(event.domEvent) && this.newContextMenu) {
      const point = { x: event.domEvent.clientX, y: event.domEvent.clientY };
      showTolliumContextMenu(this.newContextMenu, point);
    }
  }

  async updateSettings(settings: UpdatableMapSettings) {
    this.updateTolliumSettings(settings);

    if (settings.mapType !== undefined) {
      const mapTypes = {
        "map": google.maps.MapTypeId.ROADMAP,
        "satellite": google.maps.MapTypeId.SATELLITE,
        "hybrid": google.maps.MapTypeId.HYBRID,
        "physical": google.maps.MapTypeId.TERRAIN,
      };
      this.map?.setMapTypeId(mapTypes[settings.mapType] ?? google.maps.MapTypeId.ROADMAP);
    }
    // There is no separate 'restriction' property, so update it through setOptions
    if (settings.restrictTo !== undefined)
      this.map?.setOptions({
        restriction: settings.restrictTo ? {
          latLngBounds: {
            north: settings.restrictTo.ne.lat,
            east: settings.restrictTo.ne.lng,
            south: settings.restrictTo.sw.lat,
            west: settings.restrictTo.sw.lng,
          },
        } : null,
      });
    if (settings.center !== undefined)
      this.map?.setCenter(settings.center);
    if (settings.zoom !== undefined)
      this.map?.setZoom(settings.zoom);
    if (settings.showControls !== undefined)
      this.showControls = settings.showControls;
    if (settings.icons !== undefined)
      await this.updateIcons(settings.icons);
    // Update overlays and overlay clustering _after_ icons have been loaded, so they can use the icons
    if (settings.overlays !== undefined)
      this.updateOverlays(settings.overlays);
    if (settings.clusterIcon !== undefined)
      this.clusterIcon = settings.clusterIcon;
    if (settings.clusterRadius !== undefined)
      this.clusterRadius = settings.clusterRadius;
    if (settings.clusterOverlays !== undefined)
      this.clusterOverlays = settings.clusterOverlays;
  }

  private async updateIcons(icons: MapIcon[]) {
    // Load the icon images, if any
    const seen: string[] = [];
    for (const icon of icons) {
      this.icons.set(icon.name, {
        icon: {
          url: (await createTolliumImage(icon.icon, icon.width, icon.height, "c")).src,
          size: new google.maps.Size(icon.width, icon.height),
          scaledSize: new google.maps.Size(icon.width, icon.height),
          anchor: new google.maps.Point(icon.anchorX, icon.anchorY),
          labelOrigin: new google.maps.Point(icon.labelX, icon.labelY),
        },
        pixelOffset: new google.maps.Size(icon.popupX, icon.popupY),
      });
      seen.push(icon.name);
    }
    // Delete icons no longer referenced
    for (const icon of this.icons.keys())
      if (!seen.includes(icon))
        this.icons.delete(icon);
  }

  private updateOverlays(overlays: Array<MapOverlay<MapOverlayTypes>>) {
    // Update the overlays, if any
    const seen: MapOverlayRowkey[] = [];
    for (const overlay of overlays) {
      switch (overlay.type) {
        case "marker": {
          const icon = this.icons.get(overlay.icon ?? "");
          let marker = this.overlays.get(overlay.rowkey) as google.maps.Marker; // See note at top about the deprecation warning
          if (!marker) {
            marker = new google.maps.Marker({ // See note at top about the deprecation warning
              position: { lat: overlay.lat, lng: overlay.lng },
              icon: icon?.icon,
              title: overlay.hint,
              clickable: overlay.selectable,
              draggable: overlay.moveable,
            });
            if (overlay.selectable) {
              marker.addListener("click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onOverlayClick(overlay, event));
              marker.addListener("rightclick", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onOverlayRightClick(overlay, event));
            }
            if (overlay.moveable)
              marker.addListener("dragend", (event: google.maps.MapMouseEvent) => this.onOverlayMove(overlay, event));
            this.overlays.set(overlay.rowkey, marker);
            if (this.clusterOverlays)
              this.clusterer!.addMarker(marker);
            else
              marker.setMap(this.map!);
          } else {
            marker.setPosition({ lat: overlay.lat, lng: overlay.lng });
            marker.setTitle(overlay.hint);
          }
          seen.push(overlay.rowkey);
          break;
        }
        case "polyline": {
          let polyline = this.overlays.get(overlay.rowkey) as google.maps.Polyline;
          if (!polyline) {
            polyline = new google.maps.Polyline({
              map: this.map,
              path: overlay.latlngs.map(latlng => ({ lat: latlng.lat, lng: latlng.lng })),
              strokeColor: overlay.outlinecolor || defaultShapeColor,
              strokeWeight: overlay.outlinewidth,
              strokeOpacity: overlay.outlineopacity / 100,
              clickable: overlay.selectable,
            });
            polyline.addListener("click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onOverlayClick(overlay, event));
            this.overlays.set(overlay.rowkey, polyline);
          }
          seen.push(overlay.rowkey);
          break;
        }
        case "polygon": {
          let polygon = this.overlays.get(overlay.rowkey) as google.maps.Polygon;
          if (!polygon) {
            polygon = new google.maps.Polygon({
              map: this.map,
              paths: [overlay.latlngs.map(latlng => ({ lat: latlng.lat, lng: latlng.lng }))],
              strokeColor: overlay.outlinecolor || defaultShapeColor,
              strokeWeight: overlay.outlinewidth,
              strokeOpacity: overlay.outlineopacity / 100,
              fillColor: overlay.fillcolor,
              fillOpacity: overlay.fillopacity / 100,
              clickable: overlay.selectable,
            });
            polygon.addListener("click", (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => this.onOverlayClick(overlay, event));
            this.overlays.set(overlay.rowkey, polygon);
          }
          seen.push(overlay.rowkey);
          break;
        }
      }
    }
    // Delete overlays no longer referenced
    for (const overlay of this.overlays.keys())
      if (!seen.includes(overlay)) {
        const marker = this.overlays.get(overlay)!;
        if (marker instanceof google.maps.Marker && this.clusterOverlays) // See note at top about the deprecation warning
          this.clusterer!.removeMarker(marker);
        else
          marker.setMap(null);
        this.overlays.delete(overlay);
      }
    // Close the info window if its overlay is no longer present
    //FIXME: Move the info window if the overlay has moved?
    if (this.infoWindow!.overlay && !seen.includes(this.infoWindow!.overlay))
      this.infoWindow!.close();
  }

  async setViewport(viewport: LatLngBounds) {
    await this.initPromise;
    // Google map doesn't support animating this like Leaflet does (panToBounds does the minimum to move to the given bounds
    // within the current viewport, but for example doesn't change the zoom level)
    this.map?.fitBounds({
      south: viewport.sw.lat,
      west: viewport.sw.lng,
      north: viewport.ne.lat,
      east: viewport.ne.lng,
    });
  }
}

class NavControl extends NavControlObject {
  private map: google.maps.Map;
  private nodePromise: Promise<HTMLElement | void>;

  get control() {
    return this.nodePromise;
  }

  constructor(map: google.maps.Map) {
    super();
    this.map = map;
    this.nodePromise = this.createButtons();
  }

  panUp() {
    this.map.panBy(0, -(this.map.getDiv().clientHeight / 2));
  }

  panDown() {
    this.map.panBy(0, (this.map.getDiv().clientHeight / 2));
  }

  panLeft() {
    this.map.panBy(-(this.map.getDiv().clientWidth / 2), 0);
  }

  panRight() {
    this.map.panBy((this.map.getDiv().clientWidth / 2), 0);
  }

  async panCenter(event: ButtonEvent) {
    let position: GeolocationPosition | null = null;
    const button = event.currentTarget;
    try {
      this.setButtonEnabled(button, false);
      position = await MapObject.getCurrentLocation();
    } finally {
      this.setButtonEnabled(button, true);
    }
    if (position)
      //TODO: Use accuracy to zoom?
      this.map.panTo({ lat: position.coords.latitude, lng: position.coords.longitude });
  }

  zoomIn() {
    const zoom = this.map.getZoom();
    //FIXME: Get max zoom level from current map type
    if (zoom !== undefined && !isNaN(zoom) && zoom < 20)
      this.map.setZoom(zoom + 1);
  }

  zoomOut() {
    const zoom = this.map.getZoom();
    //FIXME: Get min zoom level from current map type
    if (zoom !== undefined && !isNaN(zoom) && zoom > 0)
      this.map.setZoom(zoom - 1);
  }
}

function createInfoWindow(map: google.maps.Map): InfoWindow {
  // The actual OverlayView object is only available when the maps library has been loaded, so we'll define the class using
  // it locally within a function that is called after the maps library was loaded
  class InfoWindowImpl extends google.maps.OverlayView implements InfoWindow {
    #map: google.maps.Map;
    private popupDiv: HTMLElement;
    private contentDiv: HTMLElement;
    private position?: google.maps.LatLng;
    private _overlay: MapOverlayRowkey | null = null;
    private pixelOffset?: google.maps.Size;

    get overlay() {
      return this._overlay;
    }

    constructor() {
      super();
      this.#map = map;

      // This creates a popup structure similar to the Leaflet Popup, so they can easily share the same layout
      this.popupDiv = document.createElement("div");
      this.popupDiv.className = "googlemap-popup";

      const contentWrapperDiv = document.createElement("div");
      contentWrapperDiv.className = "googlemap-popup-content-wrapper";

      this.contentDiv = document.createElement("div");
      this.contentDiv.className = "googlemap-popup-content";
      contentWrapperDiv.append(this.contentDiv);

      const tipContainerDiv = document.createElement("div");
      tipContainerDiv.className = "googlemap-popup-tip-container";

      const tipDiv = document.createElement("div");
      tipDiv.className = "googlemap-popup-tip";
      tipContainerDiv.append(tipDiv);

      const closeButton = document.createElement("a");
      closeButton.className = "googlemap-popup-close-button";
      closeButton.href = "#close";
      closeButton.role = "button";
      closeButton.ariaLabel = "Close";
      closeButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      });

      const closeSpan = document.createElement("span");
      closeSpan.textContent = "×";
      closeSpan.ariaHidden = "true";
      closeButton.append(closeSpan);

      this.popupDiv.append(contentWrapperDiv, tipContainerDiv, closeButton);

      InfoWindowImpl.preventMapHitsAndGesturesFrom(this.popupDiv);
    }

    open(position: google.maps.LatLng, overlay: MapOverlayRowkey, content: string, pixelOffset?: google.maps.Size) {
      this.position = position;
      this._overlay = overlay;
      this.contentDiv.innerHTML = content;
      this.pixelOffset = pixelOffset;
      this.setMap(this.#map);
    }

    close() {
      this._overlay = null;
      this.setMap(null);
    }

    onAdd() {
      this.getPanes()!.floatPane.append(this.popupDiv);
    }

    onRemove() {
      this.popupDiv.remove();
    }

    draw() {
      const divPosition = this.getProjection().fromLatLngToDivPixel(this.position!)!;
      if (this.pixelOffset) {
        divPosition.x += this.pixelOffset.width;
        divPosition.y += this.pixelOffset.height;
      }

      // Hide the popup when it is far out of view.
      const display = Math.abs(divPosition.x) < 4000 && Math.abs(divPosition.y) < 4000 ? "block" : "none";

      if (display === "block") {
        this.popupDiv.style.left = divPosition.x + "px";
        this.popupDiv.style.top = divPosition.y + "px";
      }

      if (this.popupDiv.style.display !== display) {
        this.popupDiv.style.display = display;
      }
    }
  }
  return new InfoWindowImpl();
}
