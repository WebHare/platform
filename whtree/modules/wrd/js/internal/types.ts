import { mapObject } from "@mod-system/js/internal/util/algorithms";
import type { AccessorType } from "./accessors";

//FIXME Shouldn't we stringify WRDMetaType, WRDGender and WRDAttributeType to also have prettier names at runtime?

/** WRD entity metatypes.
*/
export enum WRDMetaType {
  Object = 1,
  Link = 2,
  Attachment = 3,
  Domain = 4,
}

/** WRD Gender values
 */
export enum WRDGender {
  Unset = 0,
  Male = 1,
  Female = 2,
}

/** WRD attribute types. Negative values are used for base attributes (which will have a different accessor than the attributes read from settings) */
export enum WRDBaseAttributeType {
  Base_Integer = -1, // wrd_id, wrd_type
  Base_Guid = -2, // wrd_guid
  Base_Tag = -3, // tag
  Base_CreationLimitDate = -4, // wrdCreationDate, wrdLimitDate
  Base_ModificationDate = -10, // wrdModificationDate
  Base_Date = -5, // wrdDateOfBirth, wrdDateOfDeath
  Base_GeneratedString = -6, // wrdSaluteFormal, wrdAddressFormal, wrdFullName, wrdTitle
  Base_NameString = -7, // wrd_titles, wrd_initials, wrdFirstName, wrdFirstNames, wrd_infix, wrdLastName, wrdTitlesSuffix
  Base_Domain = -8, // wrdLeftEntity, wrdRightEntity
  Base_Gender = -9, // wrd_gender
}

export enum WRDAttributeType {
  Domain = 1,
  Free = 2, //TODO why not 'text'
  Address = 3,
  Email = 4,
  Telephone = 5, //TODO why not 'phone'
  Date = 6,
  Password = 7,
  DomainArray = 8,
  Image = 9,
  File = 10,
  Time = 11,
  DateTime = 12,
  Array = 13,
  Money = 14,
  Integer = 15,
  Boolean = 16,
  RichDocument = 17,
  Integer64 = 18,
  WHFSInstance = 19,
  WHFSIntextlink = 20,
  URL = 21,
  Record = 22,
  Enum = 23,
  EnumArray = 24,
  PaymentProvider = 25,
  Payment = 26,
  StatusRecord = 27,
  AuthenticationSettings = 28,
  WHFSLink = 29,
  JSON = 30
}

export const WRDAttributeTypeNames = [
  "DOMAIN", /*2*/"FREE", "ADDRESS", "EMAIL", "TELEPHONE", "DATE", "PASSWORD",
  "DOMAINARRAY", /*9*/"IMAGE", "FILE", "TIME", "DATETIME",/*13*/  "ARRAY", "MONEY",
  "INTEGER", "BOOLEAN", "RICHDOCUMENT", "INTEGER64", /*19*/"WHFSINSTANCE", "WHFSINTEXTLINK",
   /*21*/"URL", /*22*/"RECORD", /*23*/"ENUM", /*24*/"ENUMARRAY", /*25*/"PAYMENTPROVIDER", /*26*/"PAYMENT",
   /*27*/"STATUSRECORD", /*28*/"AUTHENTICATIONSETTINGS", /*29*/ "WHFSLINK", /*30*/ "JSON"
];


/** List of simple attribute types, that have no associated options
*/
export type SimpleWRDAttributeType =
  WRDBaseAttributeType.Base_Integer |
  WRDBaseAttributeType.Base_Guid |
  WRDBaseAttributeType.Base_Tag |
  WRDBaseAttributeType.Base_CreationLimitDate |
  WRDBaseAttributeType.Base_ModificationDate |
  WRDBaseAttributeType.Base_Date |
  WRDBaseAttributeType.Base_GeneratedString |
  WRDBaseAttributeType.Base_NameString |
  WRDBaseAttributeType.Base_Domain |
  WRDBaseAttributeType.Base_Gender |
  WRDAttributeType.Domain |
  WRDAttributeType.Free |
  WRDAttributeType.Address |
  WRDAttributeType.Email |
  WRDAttributeType.Telephone |
  WRDAttributeType.Date |
  WRDAttributeType.Password |
  WRDAttributeType.DomainArray |
  WRDAttributeType.Image |
  WRDAttributeType.File |
  WRDAttributeType.Time |
  WRDAttributeType.DateTime |
  WRDAttributeType.Money |
  WRDAttributeType.Integer |
  WRDAttributeType.Boolean |
  WRDAttributeType.RichDocument |
  WRDAttributeType.Integer64 |
  WRDAttributeType.WHFSInstance |
  WRDAttributeType.WHFSIntextlink |
  WRDAttributeType.URL |
  WRDAttributeType.Record |
  WRDAttributeType.JSON |
  WRDAttributeType.PaymentProvider |
  WRDAttributeType.Payment |
  WRDAttributeType.StatusRecord |
  WRDAttributeType.AuthenticationSettings |
  WRDAttributeType.WHFSLink;



/** Extended form for declaring an attribute, also supports enums and arrays properties
 * @typeParam T - WRDAttributeType for this attribute
 * @typeParam O - Options for the type. For enum/enum array use `{ allowedvalues: "a" | "b" }`, for arrays
 * use `{ members: { a: WRDAttributeType.Integer } }`
*/
export type WRDAttr<T extends WRDAttributeType | WRDBaseAttributeType, O extends (WRDAttrBase & { __attrtype: T })["__options"] = never> = {
  /// Attribute type
  __attrtype: T;
  /// Options for this attribute
  __options: T extends SimpleWRDAttributeType ? never : O;
  /// Whether the attribute is required
  __required: false;
  /// Whether the attribute is insertable
  __insertable: true;
  /// Whether the attribute is updatable
  __updatable: true;
};

export type WRDAttrBaseGen<T extends (WRDAttributeType | WRDBaseAttributeType), O extends (WRDAttrBase & { __attrtype: T })["__options"] = never> = {
  __attrtype: T;
  __options: T extends SimpleWRDAttributeType ? never : O;
  __required: boolean;
  __insertable: boolean;
  __updatable: boolean;
};

/** Base type for attributes types, all WRDAttr types and derived types extend this type. Option types for enum,
 * enum array and arrays are specified here.
*/
export type WRDAttrBase =
  WRDAttrBaseGen<SimpleWRDAttributeType, never> |
  WRDAttrBaseGen<WRDAttributeType.Enum | WRDAttributeType.EnumArray, { allowedvalues: string }> |
  WRDAttrBaseGen<WRDAttributeType.Array, { members: Record<string, SimpleWRDAttributeType | WRDAttrBase> }>;

/** Converts a SimpleWRDAttributeType (enum) to a WRDAttrBase */
export type ToWRDAttr<T extends SimpleWRDAttributeType | WRDAttrBase> = T extends WRDAttrBase ? T : T extends SimpleWRDAttributeType ? WRDAttr<T> : never;

/** Marks a WRD attribute type as required for inserts
    @typeParam T - WRD attribute type to modify
*/
export type IsRequired<T extends WRDAttrBase | SimpleWRDAttributeType> = T extends SimpleWRDAttributeType
  ? { __attrtype: T; __options: never; __required: true; __insertable: true; __updatable: true }
  : Omit<T, "__required"> & { __required: true };

/** Marks a WRD attribute type as generated (cannot be inserted or modified)
    @typeParam T - WRD attribute type to modify
*/
export type IsGenerated<T extends WRDAttrBase | SimpleWRDAttributeType> = T extends SimpleWRDAttributeType
  ? { __attrtype: T; __options: never; __required: true; __insertable: false; __updatable: false }
  : Omit<T, "__required" | "__insertable" | "__updatable"> & { __required: false; __insertable: false; __updatable: false };

/** Marks a WRD attribute type as non-updatable (can be inserted, but never updated)
    @typeParam T - WRD attribute type to modify
*/
export type IsNonUpdatable<T extends WRDAttrBase | SimpleWRDAttributeType> = T extends SimpleWRDAttributeType
  ? { __attrtype: T; __options: never; __required: false; __insertable: true; __updatable: false }
  : Omit<T, "__updatable"> & { __updatable: false };

/** Base type for the type definition of a WRD type */
export type TypeDefinition = Record<string, SimpleWRDAttributeType | WRDAttrBase>;

/** Base type for the type definition of a WRD schema */
export type SchemaTypeDefinition = Record<string, TypeDefinition>;

/** All allowed filter conditions */
export type AllowedFilterConditions = "=" | ">=" | ">" | "!=" | "<" | "<=" | "mentions" | "mentionsany" | "in" | "like" | "contains" | "intersects";

/** Base WRD type */
export type WRDTypeBaseSettings = {
  wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
  wrdGuid: WRDBaseAttributeType.Base_Guid;
  wrdType: IsGenerated<WRDBaseAttributeType.Base_Integer>;
  wrdTag: WRDBaseAttributeType.Base_Tag;
  wrdCreationDate: WRDBaseAttributeType.Base_CreationLimitDate;
  wrdLimitDate: WRDBaseAttributeType.Base_CreationLimitDate;
  wrdModificationDate: WRDBaseAttributeType.Base_ModificationDate;
};

/** Extracts the select result type for an attribute type */
export type GetResultType<T extends SimpleWRDAttributeType | WRDAttrBase> = ReturnType<AccessorType<ToWRDAttr<T>>["getValue"]>;

/** Extracts the default value type for an attribute type */
type GetDefaultType<T extends SimpleWRDAttributeType | WRDAttrBase> = ReturnType<AccessorType<ToWRDAttr<T>>["getDefaultValue"]>;

/** Gives back the allowed condition+value combinations for an attribute type */
export type GetCVPairs<T extends SimpleWRDAttributeType | WRDAttrBase> = Parameters<AccessorType<ToWRDAttr<T>>["checkFilter"]>[0];

/** Gives back the allowed input value type for an attribute type */
export type GetInputType<T extends SimpleWRDAttributeType | WRDAttrBase> = Parameters<AccessorType<ToWRDAttr<T>>["validateInput"]>[0];

/** Type of output columns, extend this when dynamic selects become possible
 * @typeParam Type - WRD type definition record
*/
export type AttrRef<Type extends TypeDefinition> = keyof Type & string;

/** Type for argumemnts to select */
export type OutputMap<T extends TypeDefinition> = AttrRef<T> | { [K: string]: OutputMap<T> } | Readonly<Array<AttrRef<T>>>;

/** Type for argumemnts to select, but all arrays converted to records */
export type RecordOutputMap<T extends TypeDefinition> = AttrRef<T> | { [K: string]: RecordOutputMap<T> };

/** Type for arguments to enrich */
export type EnrichOutputMap<T extends TypeDefinition> = { [K: string]: OutputMap<T> } | Readonly<Array<AttrRef<T>>>;

/** Converts an output array to a record */
type ConvertOutputArray<T extends TypeDefinition, M extends Readonly<Array<AttrRef<T>>>> = { [K in M[number]]: K; };

/** Converts an output array to a record output map (with the arrays converted to records) */
export type RecordizeOutputMap<T extends TypeDefinition, O extends OutputMap<T>> =
  O extends AttrRef<T>
  ? O & AttrRef<T>
  : (O extends Readonly<Array<AttrRef<T>>>
    ? ConvertOutputArray<T, O>
    : (O extends { [K: string]: OutputMap<T> }
      ? { [K in keyof O]: RecordizeOutputMap<T, O[K]> }
      : never));

// Get the attribute def (WRDAttributeType or WRDAttr of a AttrRef)
export type AttrOfAttrRef<T extends TypeDefinition, R extends AttrRef<T>> = T[R];

/** Convert an attribute reference to the selection result type */
export type MapAttrRef<T extends TypeDefinition, R extends AttrRef<T>> = GetResultType<AttrOfAttrRef<T, R>>;

/** Convert an attribute reference to the selection result type */
export type MapAttrRefForSingleItem<T extends TypeDefinition, R extends AttrRef<T>> = GetDefaultType<AttrOfAttrRef<T, R>>;

/** Calculate the selection result of a record output map */
export type MapRecordOutputMap<T extends TypeDefinition, O extends RecordOutputMap<T>> = O extends AttrRef<T>
  ? MapAttrRef<T, O>
  : (O extends { [K: string]: RecordOutputMap<T> }
    ? { -readonly [K in keyof O]: MapRecordOutputMap<T, O[K]> }
    : never);

/** Calculate the selection result of a record output map */
export type MapRecordOutputMapForSingleItem<T extends TypeDefinition, O extends RecordOutputMap<T>> = O extends AttrRef<T>
  ? MapAttrRefForSingleItem<T, O>
  : (O extends { [K: string]: RecordOutputMap<T> }
    ? { -readonly [K in keyof O]: MapRecordOutputMap<T, O[K]> }
    : never);

/** Returns whether a value is a reference to a WRD attribute
 */
export function isAttrRef<T extends TypeDefinition>(o: OutputMap<T> | RecordOutputMap<T>): o is AttrRef<T> {
  return typeof o === "string";
}

/** Returns whether a value is an array of WRD attribute references
 */
function isAttrArrayRef<T extends TypeDefinition>(o: OutputMap<T>): o is Readonly<Array<AttrRef<T>>> {
  return Array.isArray(o);
}

/** Returns whether a value a record with value-attribute reference pairs
 */
export function isAttrRecordMap<T extends TypeDefinition>(o: RecordOutputMap<T>): o is { [K: string]: RecordOutputMap<T> } {
  return !isAttrRef(o) && !isAttrArrayRef(o);
}

/** Converts an array of attribute references to a record
 */
function recordizeOutputArray<T extends TypeDefinition, O extends Readonly<Array<AttrRef<T>>>>(o: O) {
  const entries = o.map(v => ([v, v] as const));
  const res = Object.fromEntries(entries);
  return res;
}

/** Converts all arrays in an output map to records
 */
export function recordizeOutputMap<T extends TypeDefinition, O extends OutputMap<T>>(o: O): RecordizeOutputMap<T, O> {
  if (isAttrRef(o)) {
    return o as unknown as RecordizeOutputMap<T, O>;
  } else if (isAttrArrayRef(o)) {
    return recordizeOutputArray(o) as RecordizeOutputMap<T, O>;
  } else {
    // Need type override here, mapObject can't correctly determine the return type when using generic functions.
    return mapObject(o, <V extends OutputMap<T>>(v: V) => recordizeOutputMap(v)) as RecordizeOutputMap<T, O>;
  }
}

/** Combines two output records maps */
type CombineRecords<T extends TypeDefinition, B extends { [K: string]: RecordOutputMap<T> }, U extends { [K: string]: RecordOutputMap<T> }> = {
  [K in (keyof B | keyof U) & string]:
  K extends keyof U
  ? (K extends keyof B
    ? CombineRecordOutputMaps<T, B[K], U[K]>
    : U[K])
  : B[K]
};

/** Combines two record output records maps */
export type CombineRecordOutputMaps<T extends TypeDefinition, B extends RecordOutputMap<T> | null, U extends RecordOutputMap<T>> =
  B extends { [K: string]: RecordOutputMap<T> }
  ? (U extends { [K: string]: RecordOutputMap<T> }
    ? CombineRecords<T, B, U>
    : U)
  : U;

/** Combines two record output records maps */
export function combineRecordOutputMaps<T extends TypeDefinition, B extends RecordOutputMap<T> | null, U extends RecordOutputMap<T>>(b: B, u: U): CombineRecordOutputMaps<T, B, U> {
  if (b && !isAttrRef(b) && !isAttrRef(u)) {
    if (typeof b === "object" && typeof u === "object") {
      const res = { ...b } as CombineRecordOutputMaps<T, B, U> & object;
      for (const entry of Object.entries(u)) {
        const prop_base = res[entry[0]];
        const prop_update = entry[1];

        if (!prop_base)
          res[entry[0]] = prop_update;
        else if (isAttrRecordMap(prop_base) && isAttrRecordMap(prop_update))
          res[entry[0]] = combineRecordOutputMaps(prop_base, prop_update);
        else
          throw new Error(`Cannot combine selects, trying to combine a record with a field or vv`);
      }
      return res;
    }
  }
  if (b)
    throw new Error(`Cannot combine selects, trying to combine ${typeof b === "object" ? "a map" : "a single field"} with ${typeof u === "object" ? "a map" : "another single field"}`);
  return u as CombineRecordOutputMaps<T, B, U>;
}

type InsertableAndRequired<T extends WRDAttrBase> = T["__required"] extends true ? T["__insertable"] extends true ? true : false : false;

/** Returns the type for date for WRD entity creation */
export type Insertable<T extends TypeDefinition> = {
  // Exclude all non-insertable keys by remapping the key value to 'never'
  [K in keyof T as ToWRDAttr<T[K]>["__insertable"] extends true ? K : never]?: GetInputType<T[K]>
} & {
    // Make sure all members that are insertable and required are added non-optionally. No need to repeat the value type here, that will just merge
    [K in keyof T as InsertableAndRequired<ToWRDAttr<T[K]>> extends true ? K : never]: GetInputType<T[K]>
  };

/** Returns the type for updating a WRD entity */
export type Updatable<T extends TypeDefinition> = {
  // Exclude all non-updatable keys by remapping the key value to 'never'
  [K in keyof T as ToWRDAttr<T[K]>["__updatable"] extends true ? K : never]?: GetInputType<T[K]>
};

/** Single row selection result */
export type SelectionResultRow<T extends TypeDefinition, O extends OutputMap<T>> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>>;

/** Combines two attributes of a type definition. Two incompatible attributes resolve to never. FIXME: recurse into arrays
*/
export type CombineAttrs<A extends WRDAttrBase, B extends WRDAttrBase> = A extends B ? B extends A ? A : never : never;

/** Combines two types. Two incompatible attributes resolve to never */
export type CombineTypes<A extends TypeDefinition, B extends TypeDefinition> = {
  [K in keyof A | keyof B]: K extends keyof A ? K extends keyof B ? CombineAttrs<ToWRDAttr<A[K]>, ToWRDAttr<B[K]>> : A[K] : K extends keyof B ? B[K] : never;
};

/** Combines two schemas. Two incompatible attributes resolve to never */
export type CombineSchemas<A extends SchemaTypeDefinition, B extends SchemaTypeDefinition> = {
  [K in keyof A | keyof B]: K extends keyof A ? K extends keyof B ? CombineTypes<A[K], B[K]> : A[K] : K extends keyof B ? B[K] : never;
};

/** Combines an array with multiple schema types. Also accepts a simple schema, passes it through directly */
export type Combine<S extends SchemaTypeDefinition | SchemaTypeDefinition[]> = S extends [infer A extends SchemaTypeDefinition, infer B extends SchemaTypeDefinition, ...infer C extends SchemaTypeDefinition[]] ? CombineSchemas<A, Combine<[B, ...C]>> : S extends [SchemaTypeDefinition] ? S[0] : S extends SchemaTypeDefinition ? S : never;

export type AnyType = WRDTypeBaseSettings & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'unknown' might be closer but is not accepted by the rest of the WRD definitions
  [key: string]: any;
};

export type AnySchemaTypeDefinition = Record<string, AnyType>;
