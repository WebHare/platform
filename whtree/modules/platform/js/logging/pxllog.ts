import { getCityLookupCall, type CityLookupCall } from "@webhare/geoip";
import type { LogFormats } from "@webhare/services";
import { getAllModuleYAMLs, type ModDefYML } from "@webhare/services/src/moduledefparser";
import { anonymizeIPAddress } from "./parsersupport";
import type { Device, Platform } from "@webhare/dompack";

type PxlModuleFieldset = Record<string, string | number | boolean>;

type PxlModuleFields = { [K in `mod_${string}`]: PxlModuleFieldset };

export type PxlDocType = {
  "_id": string;
  "@timestamp": Temporal.Instant;
  event: string;
  userid: string;
  sessionid: string;
  pageid: string;
  objref: string;
  counter: number;
  location: string;
  referrer: string;
  user_agent: {
    os: Platform | "";
    name: string;
    major: number;
    device: Device | "";
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
  fields: Record<string, "keyword" | "integer" | "boolean">;
}>;
type FieldTypes = Map<string, string>;

function getFields(modYml: ModDefYML, event: string, includePath: string[], fieldTypes: FieldTypes): Record<string, "keyword" | "integer" | "boolean"> {
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
        case "keyword":
          if (params.has("ds_" + key))
            fields[key] = params.get(`ds_${key}`)!;
          break;
        case "boolean":
          if (params.has("db_" + key))
            fields[key] = params.get(`db_${key}`) === "true";
          break;
        case "integer":
          if (params.has("dn_" + key)) {
            const asInt = parseInt(params.get(`dn_${key}`)!);
            if (asInt >= -2147483648 && asInt <= 2147483647) //ensure its in signed 32bit range
              fields[key] = asInt;
          }
          break;
      }
    }

    const line: PxlDocType = {
      _id: logline["@id"],
      "@timestamp": logline["@timestamp"],
      event: event,
      userid: params.get("pi") || "",
      sessionid: params.get("ps") || "",
      pageid: params.get("pp") || "",
      objref: params.get("ob") || "",
      counter: Number(params.get("pc")) || 0,
      location: params.get("bl") || "",
      referrer: params.get("br") || "",
      user_agent: parseUserAgent(params.get("bt") as Platform | null, params.get("bd") as Device | null),
      screen: parseScreen(params.get("bs"), params.get("bp")),
      remoteip: anonymizeIPAddress(logline.ip),
    };

    if (georesult)
      line.geoip = {
        city: georesult.city?.names.en || '',
        country: (georesult.country || georesult.registered_country)?.iso_code || '',
        ...(georesult.location ? { location: { lat: georesult.location.latitude, lon: georesult.location.longitude } } : null),
        region: georesult.subdivisions?.[0]?.names.en || ''
      };

    if (Object.keys(fields).length)
      line[`mod_${event.split(":")[0]}`] = fields;

    return line;
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

function parseUserAgent(bt: string | null, bd: Device | null): PxlDocType["user_agent"] {
  const { 1: os, 2: name, 3: major } = bt?.match(/([^-]+)-([^-]+)-(\d+)/) || [];
  return {
    os: os as Platform || "",
    name: name || "",
    major: parseInt(major) || 0,
    device: bd as Device || ""
  };
}

export async function buildPxlParser() {
  const configs: PxlEventConfig = {};
  for (const modyml of await getAllModuleYAMLs())
    if (modyml.pxlEvents)
      Object.assign(configs, getYMLPxlConfigs(modyml));

  return new PxlParser(configs, await getCityLookupCall());
}

type HSConsilioFieldDef = {
  settings: {
    ignore_above?: number;
  } | null;
  name: string;
  suggested: boolean;
  properties: HSConsilioFieldDef[];
  type: "datetime" | "keyword" | "integer64" | "record" | "float" | "ipaddress" | "integer" | "boolean";
  defaultvalue: Date | string | number | boolean | null | bigint;
  definedby: string;
};

function getFieldMappingForModule(modYml: ModDefYML) {
  if (!modYml.pxlEvents)
    return [];

  const properties: HSConsilioFieldDef[] = [];
  const fieldTypes: FieldTypes = new Map;
  const seen = new Set<string>;
  for (const key of Object.keys(modYml.pxlEvents || {})) {
    try {
      const fields = getFields(modYml, key, [], fieldTypes);
      for (const [name, type] of Object.entries(fields)) {
        if (seen.has(name))
          continue;
        seen.add(name);

        properties.push({
          settings: type === "keyword" ? { ignore_above: 1024 } : null,
          name,
          suggested: false,
          properties: [],
          type,
          defaultvalue: null,
          definedby: modYml.baseResourcePath
        });
      }
    } catch (e) {
      //TODO Not sure yet where to push these errors but we don't want to fully shut down the pxl catalog? Probably we should just log or ignore here and have a validation step deal with it
      console.error(`Error while processing pxlEvent '${modYml.module}:${key}': ${(e as Error).message}`, { cause: e });
      return [];
    }
  }
  return properties;
}

export async function addPxlFieldMappings(fields: HSConsilioFieldDef[]) {
  for (const modYml of await getAllModuleYAMLs()) {
    const props = getFieldMappingForModule(modYml);
    if (props.length)
      fields.push({
        settings: null,
        name: `mod_${modYml.module}`,
        suggested: false,
        properties: props,
        type: "record",
        defaultvalue: null,
        definedby: modYml.baseResourcePath
      } satisfies HSConsilioFieldDef);
  }

  return fields;
}
