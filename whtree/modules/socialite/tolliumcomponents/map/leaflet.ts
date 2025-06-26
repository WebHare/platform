import * as L from "leaflet";
//@ts-ignore - MarkerClusterGroup _is_ exported in leaflet.markercluster
import { MarkerClusterGroup } from "leaflet.markercluster";
import { createTolliumImage, requestedBrowserContextMenu, showTolliumContextMenu } from "@webhare/tollium-iframe-api";
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
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";

export class LeafletMap extends MapObject {
  // Our map object
  private map?: L.Map;
  // The navigation control on the top left
  private navControl?: NavControl;
  // The available icons
  private icons: Map<string, L.Icon> = new Map();
  // The overlays to show on the map
  private overlays: Map<MapOverlayRowkey, L.Marker | L.Polyline | L.Polygon> = new Map();
  // The overlay clusterer
  private clusterGroup?: L.MarkerClusterGroup;

  // Internal property storage
  private _showControls?: boolean;
  private _clusterOverlays = false;
  private _clusterIcon = "";
  private _clusterRadius = 100;

  get showControls() {
    return Boolean(this._showControls);
  }

  set showControls(showControls: boolean) {
    void this.navControl?.control.then(control => {
      if (showControls === this._showControls)
        return;
      this._showControls = showControls;
      if (this.map && control) {
        if (this._showControls)
          control.addTo(this.map!);
        else
          control.remove();
      }
    });
  }

  get clusterOverlays() {
    return Boolean(this._clusterOverlays);
  }

  set clusterOverlays(clusterOverlays: boolean) {
    if (clusterOverlays !== this._clusterOverlays) {
      this._clusterOverlays = clusterOverlays;
      if (this.clusterOverlays) {
        // Make sure we have a MarkerClusterGroup
        if (!this.clusterGroup)
          this.clusterGroup = new MarkerClusterGroup({
            showCoverageOnHover: false,
            spiderifyOnMaxZoom: false,
            iconCreateFunction: (cluster: L.MarkerCluster) => {
              // Render a div with the cluster icon as background
              const count = cluster.getChildCount();
              const icon = this.icons.get(this.clusterIcon);
              const size = Array.isArray(icon!.options.iconSize) ? { x: icon!.options.iconSize[0], y: icon!.options.iconSize[1] } : { x: icon!.options.iconSize!.x, y: icon!.options.iconSize!.y };
              // 'shadowAnchor' is used to store the label position
              const pos = Array.isArray(icon!.options.shadowAnchor) ? { x: icon!.options.shadowAnchor[0], y: icon!.options.shadowAnchor[1] } : { x: icon!.options.shadowAnchor!.x, y: icon!.options.shadowAnchor!.y };
              return new L.DivIcon({
                ...icon!.options,
                html: `<div style="background: url(${icon!.options.iconUrl}) center no-repeat; width: ${size.x}px; height: ${size.y}px;"><span style="left: ${pos.x}px; top: ${pos.y}px;">${count}</span></div>`,
                className: "leaflet-cluster-marker",
              });
            },
            maxClusterRadius: this.clusterRadius,
          });
        // Move all markers to the cluster group
        for (const marker of [...this.overlays.values()].filter(_ => _ instanceof L.Marker)) {
          this.map!.removeLayer(marker);
          this.clusterGroup!.addLayer(marker);
        }
        // Add the cluster group to the map
        this.map!.addLayer(this.clusterGroup!);
      } else if (this.clusterGroup) {
        // Remove the cluster group from the map
        this.clusterGroup.remove();
        // Move all markers to the map
        for (const marker of this.clusterGroup.getLayers()) {
          this.clusterGroup.removeLayer(marker);
          this.map!.addLayer(marker);
        }
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

  async init(mapDiv: HTMLElement, settings: MapSettings<"leaflet">) {
    // The initialization promise we'll resolve after we're fully initialized
    const { promise, resolve } = Promise.withResolvers<void>();
    this.initPromise = promise;

    // Initialize the map object
    this.map = L.map(mapDiv, {
      zoomControl: false,
      maxBounds: settings.restrictTo ?
        [
          [settings.restrictTo.ne.lat, settings.restrictTo.ne.lng],
          [settings.restrictTo.sw.lat, settings.restrictTo.sw.lng],
        ] : undefined,
    });

    this.map.on("click", event => this.onClick(event));
    this.map.on("dblclick", event => this.onDblClick(event));
    this.map.on("move", () => this.onMoveEnd());
    this.map.on("moveend", () => this.onMoveEnd());
    this.map.on("zoomend", () => this.onZoomEnd());
    // Use a native DOM event listener instead of marker.on("contextmenu"), because adding an 'on' listener always suppresses
    // the native browser context menu)
    mapDiv.addEventListener("contextmenu", (event: MouseEvent) => this.onContextMenu(event));

    // Add the navigation control
    this.navControl = new NavControl(this.map);

    // Show the default OpenStreetMap tile layer on the map
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: `<a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>`,
    }).addTo(this.map);

    // Do the initial settings update
    await this.updateSettings(settings);
    // The map is initialized
    resolve();
  }

  deinit() {
    this.map?.remove();
  }

  private onClick(event: L.LeafletMouseEvent) {
    event.originalEvent.preventDefault();
    event.originalEvent.stopPropagation();
    this.selection = [];
    this.host.post("map_click", { pos: event.latlng });
  }

  private onDblClick(event: L.LeafletMouseEvent) {
    event.originalEvent.preventDefault();
    event.originalEvent.stopPropagation();
    this.selection = [];
    this.host.post("map_dblclick", { pos: event.latlng });
  }

  private onOverlayClick(rowkey: MapOverlayRowkey, event: L.LeafletMouseEvent) {
    event.originalEvent.preventDefault();
    event.originalEvent.stopPropagation();
    this.selection = [rowkey];
    this.host.post("overlay_click", { rowkeys: [rowkey] });
  }

  private onOverlayContextMenu(rowkey: MapOverlayRowkey, event: MouseEvent) {
    if (requestedBrowserContextMenu(event))
      return;
    event.stopPropagation(); // Don't show the map context menu
    this.selection = [rowkey];
    this.host.post("overlay_rightclick", { rowkey });
    if (this.selectContextMenu)
      showTolliumContextMenu(this.selectContextMenu, {
        // Use the original event's position instead of event.containerPoint, which always points to the overlay's position
        x: event.pageX,
        y: event.pageY
      });
  }

  private onOverlayMove(rowkey: MapOverlayRowkey, marker: L.Marker, _event: L.DragEndEvent) {
    this.selection = [rowkey];
    this.host.post("overlay_dragend", { rowkeys: [rowkey], pos: marker.getLatLng() });
  }

  private onMoveEnd() {
    const center = this.map?.getCenter();
    const bounds = this.map?.getBounds();
    if (center && bounds) {
      this.host.post("map_moveend", {
        center: center,
        bounds: {
          sw: { lat: bounds.getSouthWest().lat, lng: bounds.getSouthWest().lng },
          ne: { lat: bounds.getNorthEast().lat, lng: bounds.getNorthEast().lng },
        },
      });
    }
  }

  private onZoomEnd() {
    const zoom = this.map?.getZoom();
    const bounds = this.map?.getBounds();
    if (zoom !== undefined && !isNaN(zoom) && bounds)
      this.host.post("map_zoomend", {
        zoom,
        bounds: {
          sw: { lat: bounds.getSouthWest().lat, lng: bounds.getSouthWest().lng },
          ne: { lat: bounds.getNorthEast().lat, lng: bounds.getNorthEast().lng },
        },
      });
  }

  private onContextMenu(event: MouseEvent) {
    if (requestedBrowserContextMenu(event))
      return;
    const point = new L.Point(event.pageX, event.pageY);
    const pos = this.map?.containerPointToLatLng(point);
    if (pos)
      this.host.post("map_rightclick", { pos });
    if (this.newContextMenu)
      showTolliumContextMenu(this.newContextMenu, point);
  }

  async updateSettings(settings: UpdatableMapSettings) {
    this.updateTolliumSettings(settings);

    if (settings.center !== undefined)
      this.map?.setView([settings.center.lat, settings.center.lng], settings.zoom);
    else if (settings.zoom !== undefined)
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
      const props: L.IconOptions = {
        iconUrl: (await createTolliumImage(icon.icon, icon.width, icon.height, "c")).src,
        iconSize: [icon.width, icon.height],
        iconAnchor: [icon.anchorX, icon.anchorY],
        popupAnchor: [icon.popupX - icon.anchorX, icon.popupY - icon.anchorY],
        shadowAnchor: [icon.labelX, icon.labelY], // Use the 'shadowAnchor' to store the label position within the icon (we don't show shadows)
      };
      this.icons.set(icon.name, L.icon(props));
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
          let marker = this.overlays.get(overlay.rowkey) as L.Marker;
          if (!marker) {
            marker = L.marker([overlay.lat, overlay.lng], {
              icon,
              title: overlay.hint,
              interactive: overlay.selectable,
              draggable: overlay.moveable,
              autoPanOnFocus: false,
            });
            if (overlay.selectable)
              marker.on("click", (event: L.LeafletMouseEvent) => this.onOverlayClick(overlay.rowkey, event));
            if (overlay.moveable)
              marker.on("dragend", (event: L.DragEndEvent) => this.onOverlayMove(overlay.rowkey, marker, event));
            if (overlay.infohtml) {
              // If this overlay has 'infohtml' to show, show a popup
              marker.bindPopup(overlay.infohtml, {
                // maxWidth is the maximum width of the content between the left padding and the close button on the right
                // 40 = var(--tollium-padding) + var(--closebutton-size)
                maxWidth: window.innerWidth - 40,
                minWidth: 0,
                autoPanPadding: [0, 0],
              });
              // The default popup closing functionality doesn't seem to properly cancel the click event, causing a window to
              // open for the close button's "#close" href. This is a bit of a hack to handle clicking the close button
              // ourselves, properly cancelling the close button's default behavior.
              const closePopup = (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                marker.getPopup()!.close();
              };
              marker.on("popupopen", (event: L.PopupEvent) => {
                //@ts-ignore - _closeButton is an internal property that isn't exposed
                event.popup._closeButton.addEventListener("click", closePopup, true);
              });
              marker.on("popupclose", (event: L.PopupEvent) => {
                //@ts-ignore - _closeButton is an internal property that isn't exposed
                event.popup._closeButton.removeEventListener("click", closePopup, true);
              });
            }
            this.overlays.set(overlay.rowkey, marker);
            if (this.clusterOverlays)
              this.clusterGroup!.addLayer(marker);
            else
              marker.addTo(this.map!);
            // Add the element event listener after the marker is added to the map (we're using a native DOM event listener
            // instead of marker.on("contextmenu"), because adding an 'on' listener always suppresses the native browser
            // context menu)
            if (overlay.selectable)
              marker.getElement()?.addEventListener("contextmenu", (event: MouseEvent) => this.onOverlayContextMenu(overlay.rowkey, event));
          } else {
            marker.setLatLng([overlay.lat, overlay.lng]);
            // A Leaflet marker doesn't have a property to update the title, so we'll just update the marker's element's
            // title directly
            const elt = marker.getElement();
            if (elt)
              elt.title = overlay.hint;
          }
          seen.push(overlay.rowkey);
          break;
        }
        case "polyline": {
          let polyline = this.overlays.get(overlay.rowkey) as L.Polyline;
          if (!polyline) {
            polyline = L.polyline(overlay.latlngs.map(latlng => [latlng.lat, latlng.lng]), {
              color: overlay.outlinecolor || defaultShapeColor,
              weight: overlay.outlinewidth,
              opacity: overlay.outlineopacity / 100,
              interactive: overlay.selectable,
            }).addTo(this.map!);
            polyline.on("click", (event: L.LeafletMouseEvent) => this.onOverlayClick(overlay.rowkey, event));
            this.overlays.set(overlay.rowkey, polyline);
          }
          seen.push(overlay.rowkey);
          break;
        }
        case "polygon": {
          let polygon = this.overlays.get(overlay.rowkey) as L.Polygon;
          if (!polygon) {
            polygon = L.polygon(overlay.latlngs.map(latlng => [latlng.lat, latlng.lng]), {
              color: overlay.outlinecolor || defaultShapeColor,
              weight: overlay.outlinewidth,
              opacity: overlay.outlineopacity / 100,
              fillColor: overlay.fillcolor,
              fillOpacity: overlay.fillopacity / 100,
              interactive: overlay.selectable,
            }).addTo(this.map!);
            polygon.on("click", (event: L.LeafletMouseEvent) => this.onOverlayClick(overlay.rowkey, event));
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
        if (marker instanceof L.Marker && this.clusterOverlays)
          this.clusterGroup!.removeLayer(marker);
        else
          marker.remove();
        this.overlays.delete(overlay);
      }
  }

  async setViewport(viewport: LatLngBounds) {
    await this.initPromise;
    this.map?.fitBounds([
      [viewport.sw.lat, viewport.sw.lng],
      [viewport.ne.lat, viewport.ne.lng],
    ], { animate: true });
  }
}

class NavControl extends NavControlObject {
  private map: L.Map;
  private controlPromise: Promise<L.Control | void>;

  get control() {
    return this.controlPromise;
  }

  constructor(map: L.Map) {
    super();
    this.map = map;

    // Create the buttons, then add the control to the map
    this.controlPromise = this.createButtons()
      .then(node => {
        // Then add the control to the map
        const Control = L.Control.extend({
          onAdd: (_map: L.Map) => node,
          onRemove: (_map: L.Map) => { },
        });
        const control = (opts?: L.ControlOptions) => new Control(opts);
        return control({ position: "topleft" });
      })
      .catch(error => console.error(error));
  }

  panUp() {
    this.map.panBy([0, -this.map.getSize().y / 2]);
  }

  panDown() {
    this.map.panBy([0, this.map.getSize().y / 2]);
  }

  panLeft() {
    this.map.panBy([-this.map.getSize().x / 2, 0]);
  }

  panRight() {
    this.map.panBy([this.map.getSize().x / 2, 0]);
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
      this.map.panTo([position.coords.latitude, position.coords.longitude]);
  }

  zoomIn() {
    this.map.zoomIn();
  }

  zoomOut() {
    this.map.zoomOut();
  }
}
