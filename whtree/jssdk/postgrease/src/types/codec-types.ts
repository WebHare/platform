import type { RequestBuilder } from "../request-builder";
import type { UndocumentedBuffer } from "./node-types";

export type CodecTest =
  | { type: "number"; integer: true; signed: boolean; bits: 16 | 32 | 64 }
  | { type: "number"; integer: false }
  | { type: "string"; test?: (value: string) => boolean }
  | { type: "boolean" }
  | { type: "bigint"; test: (value: bigint) => boolean }
  | {
    type: "object";
    // Lower priorities numbers are tested first, null excludes from auto detection
    priority: number | null;
    test: (value: object) => boolean;
  }
  | { type: "json" } // for json(b)
  | { type: "null" }; // for nulls

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCodec = Codec<any, any>;

export type Codec<In, Out> = {
  /// Name of this type (use the typname from pg_type)
  name: string;
  /// OID of this type
  oid: number;
  /// Function to encode this type in binary format. Return null to encode as NULL
  encodeBinary: ((builder: RequestBuilder, value: In) => null | void);
  /** Function to decode the binary representation of this type. The data is in the buffer at buffer[offset] and dataview[offset] with length len.
   */
  decodeBinary: (buffer: UndocumentedBuffer, dataview: DataView, offset: number, len: number) => Out;
  /** Optional JIT decoder function for this type.
   * @param retval The variable name that must be filled with the decoded value
   * @param codecExpr An expression that evaluates to this codec object (to access jitDecoderContext)
   */
  jitDecoder?: (retval: string, codecExpr: string) => string;
  /** Context for the JIT decoder. */
  jitDecoderContext?: unknown;
} & ({
  arrayEltCodec?: never;
  /** Tests whether a value matches this codec */
  test: CodecTest;
} | {
  /** When this codec is for an array type, contains the codec for the element type */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrayEltCodec: Codec<any, any>;
  test?: never;
});

export class Tid {
  block!: number;
  offset!: number;

  constructor(block: number, offset: number) {
    this.block = block;
    this.offset = offset;
  }
}

export class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export class Circle {
  x: number;
  y: number;
  r: number;

  constructor(x: number, y: number, r: number) {
    this.x = x;
    this.y = y;
    this.r = r;
  }
}

export class Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }
}

export class LSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }
}
