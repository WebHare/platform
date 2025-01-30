/* @webhare/geoip wraps the Maxmind geoip library

  Uses https://www.npmjs.com/package/maxmind

  This product includes GeoLite data created by MaxMind, available from http://maxmind.com/
*/

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/geoip" {
}

import { backendConfig } from '@webhare/services/src/config.ts';
import type { CityResponse, CountryResponse, Reader } from 'maxmind';

export { type CityResponse, type CountryResponse } from 'maxmind';
export type CityLookupCall = (ip: string) => CityResponse | null;
export type CountryLookupCall = (ip: string) => CountryResponse | null;

let maxmindlib: Promise<typeof import('maxmind')> | undefined;
interface ResponseTypes {
  city: CityResponse;
  country: CountryResponse;
}

/* DBs maps to proimised readers of each of the supported types */
type DBs = { [T in keyof ResponseTypes]?: Promise<Reader<ResponseTypes[T]>> };
/* Cache references to the DBs */
let dbs: Partial<DBs> | undefined;

async function lookup<T extends keyof DBs>(type: T): Promise<((ip: string) => ResponseTypes[T] | null) | null> {
  if (!dbs?.[type]) {
    if (!maxmindlib)
      maxmindlib = import('maxmind');

    const lib = await maxmindlib;
    if (!dbs?.[type]) { //noone raced us to it
      dbs ||= {};
      dbs[type] = lib.open(backendConfig.dataroot + `geoip/geoip-${type}.mmdb`);
    }
  }

  try {
    const reader = await (dbs[type]!);
    return (ip: string) => reader.get(ip);
  } catch {
    return null; //lookup failed
  }
}

/** Build a lookup function that synchronously lookups a city by IP in the database */
export async function getCityLookupCall(): Promise<CityLookupCall | null> {
  return await lookup("city");
}
/** Build a lookup function that synchronously lookups a country by IP in the database */
export async function getCountryLookupCall(): Promise<CountryLookupCall | null> {
  return await lookup("country");
}

export async function lookupCityInfo(ip: string): Promise<CityResponse | null> {
  return (await lookup("city"))?.(ip) || null;
}

export async function lookupCountryInfo(ip: string): Promise<CountryResponse | null> {
  return (await lookup("country"))?.(ip) || null;
}
