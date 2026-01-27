// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/postgrease" {
}

export { defaultCodecs } from "./codecs";
export type { Codec } from "./types/codec-types";
export { DataTypeOids } from "./types/oids";
export { CodecRegistry } from "./codec-registry";
export { nonDateCodecs, DataTypeTimeStampTzTemporal, DataTypeTimeStampTzTemporalArray } from "./codecs";
export { bindParam, DatabaseError, type PGBoundParam, connect, type PGConnection, type PGQueryOptions, type PGQueryResult } from "./connection";
