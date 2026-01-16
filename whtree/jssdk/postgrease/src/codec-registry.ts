/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Codec } from "./types/codec-types";

export class CodecRegistry {
  private oidToCodecMap: Map<number, Codec<any, any>> = new Map();
  private nameToCodecMap: Map<string, Codec<any, any>> = new Map();
  private objectsMapping: { priority: number; test: (value: object) => boolean; value: Codec<any, any>; array: Codec<any, any> | null }[] = [];

  constructor(initialCodecs?: Codec<any, any>[]) {
    if (initialCodecs)
      this.register(initialCodecs);
  }


  register<In, Out>(codecs: Codec<In, Out> | Codec<In, Out>[]) {
    for (const codec of (Array.isArray(codecs) ? codecs : [codecs])) {
      this.oidToCodecMap.set(codec.oid, codec);
      this.nameToCodecMap.set(codec.name, codec);
      if (codec.test && codec.test.type === "object" && codec.test.priority !== null) {
        const testPriority = codec.test.priority ?? 0;
        let r = this.objectsMapping.length - 1;
        for (; r >= 0; r--) {
          if (this.objectsMapping[r].priority <= testPriority)
            break;
        }
        this.objectsMapping.splice(r + 1, 0, {
          test: codec.test.test,
          priority: testPriority,
          value: codec,
          array: null,
        });
      } else if (codec.arrayEltCodec) {
        const map = this.objectsMapping.find(m => m.value === codec.arrayEltCodec);
        if (map)
          map.array = codec;
      }
    }
  }

  getCodec(codec: number | string | Codec<any, any>): Codec<any, any> {
    if (typeof codec !== "object") {
      const res = typeof codec === "number" ? this.oidToCodecMap.get(codec) : this.nameToCodecMap.get(codec);
      if (!res) {
        console.log(this.nameToCodecMap.keys());
        throw new Error(`No codec for type ${typeof codec === "number" ? `with OID ${codec}` : `with name ${JSON.stringify(codec)}`}`);
      }
      return res;
    }
    return codec;
  }

  getCodecByOid(oid: number): Codec<any, any> | undefined {
    return this.oidToCodecMap.get(oid);
  }

  getCodecByName(name: string): Codec<any, any> | undefined {
    return this.nameToCodecMap.get(name);
  }

  determineCodec(value: unknown): Codec<any, any> | null {
    if (Array.isArray(value)) {
      let test = value;
      for (let i = 0, e = test.length; i < e; i++) {
        const elem = test[i];
        if (elem !== null && elem !== undefined) {
          if (typeof elem === "string")
            return this.getCodec("_text");
          if (typeof elem === "number") {
            let min = elem, max = elem, is_int = Number.isInteger(elem);
            for (; i < e; i++) {
              let n = test[i];
              if (n === null || n === undefined)
                continue;
              if (typeof n !== "number" && Array.isArray(n)) {
                test = test.flat();
                n = test[i];
                if (n === null || n === undefined)
                  continue;
              }
              if (typeof n !== "number")
                return null; // can't determine
              if (is_int && !Number.isInteger(n))
                is_int = false;
              if (n < min)
                min = n;
              if (n > max)
                max = n;
            }
            if (is_int) {
              if (min >= -32678 && max <= 32767)
                return this.getCodec("_int2");
              if (min >= -2147483648 && max <= 2147483647)
                return this.getCodec("_int4");
              if (Number.isSafeInteger(min) && Number.isSafeInteger(max))
                return this.getCodec("_int8");
            }
            return this.getCodec("_float8");
          }
          if (typeof elem === "boolean") {
            for (; i < e; i++) {
              let n = test[i];
              if (n === null || n === undefined)
                continue;
              if (typeof n !== "boolean" && Array.isArray(n)) {
                test = test.flat();
                n = test[i];
                if (n === null || n === undefined)
                  continue;
              }
              if (typeof n !== "boolean")
                return null; // can't determine
            }
            return this.getCodec("_bool");
          }
          if (typeof elem === "object") {
            mappingLoop:
            for (let o = 0, e_m = this.objectsMapping.length; o < e_m; o++) {
              const mapping = this.objectsMapping[o];
              if (!mapping.array)
                continue;
              if (mapping.test(elem)) {
                for (let o_i = i; o_i < e; o_i++) {
                  let n = test[i];
                  if (n === null || n === undefined)
                    continue;
                  if (Array.isArray(n)) {
                    test = test.flat();
                    n = test[i];
                    if (n === null || n === undefined)
                      continue;
                  }
                  if (typeof n !== "object")
                    return null;
                  if (!mapping.test(n))
                    continue mappingLoop;
                }
                return this.getCodec(mapping.array);
              }
            }
            // no matching object type
            return null;
          }
          if (typeof elem === "bigint") {
            for (; i < e; i++) {
              let n = test[i];
              if (n !== null && n !== undefined) {
                if (typeof n !== "bigint" && Array.isArray(n)) {
                  test = test.flat();
                  n = test[i];
                }
                if (typeof n !== "bigint")
                  return null; // can't determine
              }
            }
            return this.getCodec("_int8");
          }
          // can't determine element type
          return null;
        }
      }
      // all nulls. Default to text[]
      return this.getCodec("_text");
    }
    // non-array
    if (typeof value === "string")
      return this.getCodec("text");
    if (typeof value === "number") {
      if (Number.isInteger(value)) {
        if (value >= -32768 && value <= 32767)
          return this.getCodec("int2");
        if (value >= -2147483648 && value <= 2147483647)
          return this.getCodec("int4");
        if (Number.isSafeInteger(value))
          return this.getCodec("int8");
      }
      return this.getCodec("float8");
    }
    if (typeof value === "boolean")
      return this.getCodec("bool");
    if (typeof value === "object" && value) {
      for (const mapping of this.objectsMapping)
        if (mapping.test(value))
          return mapping.value;
      return null;
    }
    if (typeof value === "bigint" && value >= -9223372036854775808n && value <= 9223372036854775807n)
      return this.getCodec("int8");
    if (value === null)
      return this.getCodec("unknown");
    return null;
  }

  testValue(codec: Codec<any, any>, value: unknown): boolean {
    if (Array.isArray(value)) {
      if (!codec.arrayEltCodec)
        return false;
      for (let i = 0, e = value.length; i < e; i++) {
        let elem = (value as any[])[i];
        if (Array.isArray(elem)) {
          value = (value as any[]).flat();
          elem = (value as any[])[i];
        }
        if (elem === null)
          continue;
        if (!this.testValue(codec.arrayEltCodec, elem))
          return false;
      }
      return true;
    }
    if (codec.arrayEltCodec)
      throw new Error(`Expected an array value for codec ${codec.name}, but got non-array value`);
    switch (codec.test.type) {
      case "number": {
        // allow bigint for int8
        if (typeof value === "bigint" && codec.test.integer && codec.test.bits === 64) {
          return value >= -9223372036854775808n && value <= 9223372036854775807n;
        }
        if (typeof value !== "number")
          return false;
        if (!codec.test.integer)
          return true;
        if (!Number.isInteger(value))
          return false;
        if (codec.test.signed) {
          if (codec.test.bits === 16) {
            if (value < -32768 || value > 32767)
              return false;
          } else if (codec.test.bits === 32) {
            if (value < -2147483648 || value > 2147483647)
              return false;
          } // else bits == 64, no range check needed
        } else {
          if (codec.test.bits === 16) {
            if (value < 0 || value > 65535)
              return false;
          } else if (codec.test.bits === 32) {
            if (value < 0 || value > 4294967295)
              return false;
          } // else bits == 64, no range check needed
        }
        return true;
      }
      case "string":
        return typeof value === "string" && (!codec.test.test || codec.test.test(value));
      case "boolean":
        return typeof value === "boolean";
      case "bigint":
        return typeof value === "bigint" && codec.test.test(value);
      case "object":
        if (typeof value !== "object" || !value)
          return false;
        return codec.test.test(value);
      case "json":
        // TODO: check internals of JSON too if no undefined, function or null chars in strings?
        return value !== undefined && typeof value !== "function" && (typeof value !== "string" || !value.includes("\x00"));
      case "null":
        return value === null;
    }
  }
}
