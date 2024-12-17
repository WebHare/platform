import { getCityLookupCall, type CityLookupCall } from "@webhare/geoip";
import type { LogFormats } from "@webhare/services";
import { getAllModuleYAMLs, type ModDefYML } from "@webhare/services/src/moduledefparser";
import { anonymizeIPAddress } from "./parsersupport";

type PxlModuleFieldset = Record<string, string | number | boolean>;

type PxlModuleFields = { [K in `mod_${string}`]: PxlModuleFieldset };

export type PxlDocType = {
  "@timestamp": Date;
  event: string;
  userid: string;
  sessionid: string;
  pageid: string;
  counter: number;
  location: string;
  referrer: string;
  user_agent: {
    os: string;
    name: string;
    major: number;
    device: string;
  };
  screen: {
    width: number;
    height: number;
    pixelratio: number;
  };
  remoteip: string;
  geoip?: {
    country: string;
    location?: {
      lat: number;
      lon: number;
    };
    region: string;
    city: string;
  };
} & PxlModuleFields;

type PxlEventConfig = Record<string, {
  fields: Record<string, "string" | "number" | "boolean">;
}>;
type FieldTypes = Map<string, string>;

function getFields(modYml: ModDefYML, event: string, includePath: string[], fieldTypes: FieldTypes): Record<string, "string" | "number" | "boolean"> {
  const eventInfo = modYml.pxlEvents?.[event];
  if (!eventInfo)
    throw new Error(`Unknown event '${eventInfo}'`);

  const fields = { ...eventInfo.fields };
  for (const [key, type] of Object.entries(fields)) {
    if (fieldTypes.has(key)) {
      if (fieldTypes.get(key) !== type)
        throw new Error(`pxlEvent field '${key}' is declared as both a '${fieldTypes.get(key)}' and a '${type}' in this module`);
    } else {
      fieldTypes.set(key, type);
    }
  }

  if (eventInfo.includeFields) {
    if (includePath.includes(eventInfo.includeFields))
      throw new Error(`Circular includeFields ${includePath.join(" -> ")} -> ${eventInfo.includeFields}`);

    includePath.push(eventInfo.includeFields);

    const includedFields = getFields(modYml, eventInfo.includeFields, includePath, fieldTypes);
    Object.assign(fields, includedFields);
  }

  return fields;
}

export function getYMLPxlConfigs(modYml: ModDefYML): PxlEventConfig {
  const configs: PxlEventConfig = {};
  const fieldTypes: FieldTypes = new Map;

  for (const [key] of Object.entries(modYml.pxlEvents || {})) {
    try {
      const fields = getFields(modYml, key, [], fieldTypes);
      configs[`${modYml.module}:${key}`] = { fields };
    } catch (e) {
      throw new Error(`Error while processing pxlEvent '${modYml.module}:${key}': ${(e as Error).message}`, { cause: e });
    }
  }
  return configs;
}

class PxlParser {
  constructor(private config: PxlEventConfig, private lookupper: CityLookupCall | null) {
  }

  /** Parse a pxl line to a document (which means we keep the ds_/db_/dn_ prefix as otherwise
   *  two unrelated events might share a field name but with different types)
  ) */
  parseLine(logline: LogFormats["platform:pxl"]): PxlDocType | null {
    const params = new URL(logline.url).searchParams;
    const event = params.get("pe") || "";
    const eventDef = this.config[event];
    if (!eventDef)
      return null;

    const georesult = this.lookupper?.(logline.ip);
    const fields: PxlModuleFieldset = {};
    for (const [key, type] of Object.entries(eventDef.fields)) {
      switch (type) {
        case "string":
          if (params.has("ds_" + key))
            fields[key] = params.get(`ds_${key}`)!;
          break;
        case "boolean":
          if (params.has("db_" + key))
            fields[key] = params.get(`db_${key}`) === "true";
          break;
        case "number":
          if (params.has("dn_" + key))
            fields[key] = parseInt(params.get(`dn_${key}`)!) || 0;
          break;
      }
    }

    return {
      "@timestamp": logline["@timestamp"],
      event: event,
      userid: params.get("pi") || "",
      sessionid: params.get("ps") || "",
      pageid: params.get("pp") || "",
      counter: Number(params.get("pc")) || 0,
      location: params.get("bl") || "",
      referrer: params.get("br") || "",
      user_agent: parseUserAgent(params.get("bt"), params.get("bd")),
      screen: parseScreen(params.get("bs"), params.get("bp")),
      remoteip: anonymizeIPAddress(logline.ip),
      ...(georesult ? {
        geoip: {
          city: georesult.city?.names.en || '',
          country: (georesult.country || georesult.registered_country)?.iso_code || '',
          ...(georesult.location ? { location: { lat: georesult.location.latitude, lon: georesult.location.longitude } } : null),
          region: georesult.subdivisions?.[0]?.names.en || ''
        }
      } : null),
      [`mod_${event.split(":")[0]}`]: fields
    };
  }
}

function parseScreen(bs: string | null, bp: string | null): PxlDocType["screen"] {
  if (!bs)
    return { width: 0, height: 0, pixelratio: 0 };

  const match = bs.match(/^(\d+)x(\d+)$/);
  if (!match)
    return { width: 0, height: 0, pixelratio: 0 };
  else
    return { width: parseInt(match[1]), height: parseInt(match[2]), pixelratio: parseInt(bp || '') || 0 };
}

function parseUserAgent(bt: string | null, bd: string | null): PxlDocType["user_agent"] {
  const { 1: os, 2: name, 3: major } = bt?.match(/([^-]+)-([^-]+)-(\d+)/) || [];
  return {
    os: os || "",
    name: name || "",
    major: parseInt(major) || 0,
    device: bd || ""
  };
}

export async function buildPxlParser() {
  const configs: PxlEventConfig = {};
  for (const modyml of await getAllModuleYAMLs())
    if (modyml.pxlEvents)
      Object.assign(configs, getYMLPxlConfigs(modyml));

  return new PxlParser(configs, await getCityLookupCall());
}
