import { toCamelCase, type ToSnakeCase } from "@webhare/std";
import { type GuestProtocol, Host, runSimpleScreen, setupGuest, type HostContext } from "@webhare/tollium-iframe-api";
import "@webhare/tollium-iframe-api/styling";
import { GoogleMap } from "./googlemap";
import { LeafletMap } from "./leaflet";
import type { LatLngBounds, MapHostProtocol, MapObject, MapSettings, MapProviders, UpdatableMapSettings } from "./support";
import "./map.css";
import "./map.lang.json";

const host = new Host<MapHostProtocol>();

let mapSettings: MapSettings<MapProviders> | undefined = undefined;
let mapDiv: HTMLElement | undefined = undefined;
let mapObj: MapObject | undefined = undefined;

async function ensureMapObject(settings: MapSettings<MapProviders>) {
  // If any of the non-updatable settings has changed, we need to re-initialize
  const shouldReinitialize = !mapObj || !mapSettings
    || (settings.provider && settings.provider !== mapSettings.provider)
    || (settings.language && settings.language !== mapSettings.language)
    || (settings.provider === "googlemap" && mapSettings.provider === "googlemap" && settings.key !== mapSettings.key);

  // Store the new settings
  mapSettings = settings;
  if (!mapSettings.provider)
    return;
  //console.info({mapSettings,shouldReinitialize});

  // If the map object doesn't have to be reinitialized, just update the existing map
  if (!shouldReinitialize) {
    await mapObj!.update(mapSettings); // shouldReinitialize cannot be false if mapObj isn't defined
    return;
  } else if (mapObj) {
    mapObj.deinit();
    mapDiv!.remove(); // If mapObj is defined, mapDiv is as well
  }
  switch (mapSettings.provider) {
    case "leaflet": {
      mapObj = new LeafletMap(host);
      break;
    }
    case "googlemap": {
      mapObj = new GoogleMap(host);
      break;
    }
  }
  if (!mapObj)
    throw new Error(`Unsupported map provider '${mapSettings.provider}'`);

  mapDiv = document.createElement("div");
  mapDiv.id = "map";
  document.body.appendChild(mapDiv);

  try {
    await mapObj.init(mapDiv!, mapSettings);
  } catch (e) {
    console.error(e);
    void runSimpleScreen("error", (e as Error).message);
  }
}

// Called from HareScript with snake-cased settings
async function init(_context: HostContext, settings: ToSnakeCase<MapSettings<MapProviders>>) {
  void ensureMapObject(toCamelCase(settings));
}

const endpoints: GuestProtocol = {
  // Called from HareScript with snake-cased settings
  update: async (settings: ToSnakeCase<UpdatableMapSettings>) => {
    if (mapObj)
      await mapObj.update(toCamelCase(settings));
  },

  set_viewport: async (viewport: LatLngBounds) => {
    if (mapObj)
      await mapObj.setViewport(viewport);
  },
};

setupGuest(init, endpoints);
