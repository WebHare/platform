import { mapObject } from "@mod-system/js/internal/util/algorithms";
import type { AccessorType } from "./accessors";

//FIXME Shouldn't we stringify WRDMetaType, WRDGender and WRDAttributeType to also have prettier names at runtime?

/** WRD entity metatypes.
*/
export enum WRDMetaTypeId {
  Object = 1,
  Link = 2,
  Attachment = 3,
  Domain = 4,
}

export const WRDMetaTypes = ["object", "link", "attachment", "domain"] as const;
export type WRDMetaType = typeof WRDMetaTypes[number];

/** WRD Gender values
 */
export enum WRDGender {
  Male = "male",
  Female = "female",
  Other = "other"
}

/** WRD attribute types. Negative values are used for base attributes (which will have a different accessor than the attributes read from settings) */
export enum WRDBaseAttributeTypeId {
  Base_Integer = -1, // wrd_ordering
  Base_Guid = -2, // wrd_guid
  Base_Tag = -3, // tag
  Base_CreationLimitDate = -4, // wrdCreationDate, wrdLimitDate
  Base_ModificationDate = -10, // wrdModificationDate
  Base_Date = -5, // wrdDateOfBirth, wrdDateOfDeath
  Base_GeneratedString = -6, // wrdFullName, wrdTitle
  Base_NameString = -7, // wrd_titles, wrd_initials, wrdFirstName, wrdFirstNames, wrd_infix, wrdLastName, wrdTitles, wrdTitlesSuffix
  Base_Domain = -8, // wrdLeftEntity, wrdRightEntity
  Base_Gender = -9, // wrd_gender
  Base_FixedDomain = -11, // wrd_id, wrd_type
}

export enum WRDAttributeTypeId {
  Domain = 1,
  String = 2, //TODO why not 'text'
  Address = 3,
  Email = 4,
  Telephone = 5, //why not 'phone' - well maybe we should consider that *once we start normalizing/validating input*
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
  RichTextDocument = 17,
  Integer64 = 18,
  Instance = 19,
  IntExtLink = 20,
  URL = 21,
  HSON = 22,
  Enum = 23,
  EnumArray = 24,
  PaymentProvider = 25,
  Payment = 26,
  DeprecatedStatusRecord = 27,
  AuthenticationSettings = 28,
  WHFSRef = 29,
  JSON = 30
}

export const WRDBaseAttributeTypes = [
  "integer", // -1 Base_Integer, wrd_ordering
  "string", // -2 Base_Guid, wrd_guid
  "string", // -3 Base_Tag, tag
  "instant", // -4 Base_CreationLimitDate, wrdCreationDate, wrdLimitDate
  "plainDate", // -5 Base_Date, wrdDateOfBirth, wrdDateOfDeath
  "string", // -6 Base_GeneratedString, wrdFullName, wrdTitle
  "string", // -7 Base_NameString, wrd_titles, wrd_initials, wrdFirstName, wrdFirstNames, wrd_infix, wrdLastName, wrdTitles, wrdTitlesSuffix
  "domain", // -8 Base_Domain, wrdLeftEntity, wrdRightEntity
  "enum", // -9 Base_Gender, wrd_gender
  "instant", // -10 Base_ModificationDate, wrdModificationDate
  "integer", // -11 Base_FixedDomain, wrd_id, wrd_type
] as const;

export const WRDAttributeTypes = [
  "domain", /*2*/"string", "address", "email", "telephone", "plainDate", "password",
  "domainArray", /*9*/"image", "file", "plainTime", "instant",/*13*/  "array", "money",
  "integer", "boolean", "richTextDocument", "integer64", /*19*/"instance", "intExtLink",
   /*21*/"url", /*22*/"hson", /*23*/"enum", /*24*/"enumArray", /*25*/"paymentProvider", /*26*/"payment",
   /*27*/"deprecatedStatusRecord", /*28*/"authenticationSettings", /*29*/ "whfsRef", /*30*/ "json"
] as const;

export type WRDAttributeType = typeof WRDAttributeTypes[number];

/** List of simple attribute types, that have no associated options
*/
export type SimpleWRDAttributeType =
  WRDBaseAttributeTypeId.Base_Integer |
  WRDBaseAttributeTypeId.Base_Guid |
  WRDBaseAttributeTypeId.Base_Tag |
  WRDBaseAttributeTypeId.Base_CreationLimitDate |
  WRDBaseAttributeTypeId.Base_ModificationDate |
  WRDBaseAttributeTypeId.Base_Date |
  WRDBaseAttributeTypeId.Base_GeneratedString |
  WRDBaseAttributeTypeId.Base_NameString |
  WRDBaseAttributeTypeId.Base_Domain |
  WRDBaseAttributeTypeId.Base_Gender |
  WRDBaseAttributeTypeId.Base_FixedDomain |
  WRDAttributeTypeId.Domain |
  WRDAttributeTypeId.String |
  WRDAttributeTypeId.Address |
  WRDAttributeTypeId.Email |
  WRDAttributeTypeId.Telephone |
  WRDAttributeTypeId.Date |
  WRDAttributeTypeId.Password |
  WRDAttributeTypeId.DomainArray |
  WRDAttributeTypeId.Image |
  WRDAttributeTypeId.File |
  WRDAttributeTypeId.Time |
  WRDAttributeTypeId.DateTime |
  WRDAttributeTypeId.Money |
  WRDAttributeTypeId.Integer |
  WRDAttributeTypeId.Boolean |
  WRDAttributeTypeId.RichTextDocument |
  WRDAttributeTypeId.Integer64 |
  WRDAttributeTypeId.Instance |
  WRDAttributeTypeId.IntExtLink |
  WRDAttributeTypeId.URL |
  WRDAttributeTypeId.HSON |
  WRDAttributeTypeId.PaymentProvider |
  WRDAttributeTypeId.Payment |
  WRDAttributeTypeId.AuthenticationSettings |
  WRDAttributeTypeId.WHFSRef;


export const baseAttrCells = {
  "wrdTag": "tag",
  "wrdInitials": "initials",
  "wrdFirstName": "firstname",
  "wrdFirstNames": "firstnames",
  "wrdInfix": "infix",
  "wrdLastName": "lastname",
  "wrdTitles": "titles",
  "wrdTitlesSuffix": "titles_suffix",
  "wrdGuid": "guid",
  "wrdGender": "gender",
  "wrdFullName": ["initials", "firstname", "firstnames", "lastname", "infix"],
  "wrdTitle": ["initials", "firstname", "firstnames", "lastname", "infix"],
  "wrdId": "id",
  "wrdType": "type",
  "wrdOrdering": "ordering",
  "wrdLeftEntity": "leftentity",
  "wrdRightEntity": "rightentity",
  "wrdDateOfBirth": "dateofbirth",
  "wrdDateOfDeath": "dateofdeath",
  "wrdCreationDate": "creationdate",
  "wrdLimitDate": "limitdate",
  "wrdModificationDate": "modificationdate",
} as const;

/** Extended form for declaring an attribute, also supports enums and arrays properties
 * @typeParam T - WRDAttributeType for this attribute
 * @typeParam O - Options for the type. For enum/enum array use `{ allowedValues: "a" | "b" }`, for arrays
 * use `{ members: { a: WRDAttributeType.Integer } }`
*/
export type WRDAttr<T extends WRDAttributeTypeId | WRDBaseAttributeTypeId, O extends (WRDAttrBase & { __attrtype: T })["__options"] = never> = {
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

export type WRDAttrBaseGen<T extends (WRDAttributeTypeId | WRDBaseAttributeTypeId), O extends (WRDAttrBase & { __attrtype: T })["__options"] = never> = {
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
  WRDAttrBaseGen<WRDAttributeTypeId.Enum | WRDAttributeTypeId.EnumArray, { allowedValues: string }> |
  WRDAttrBaseGen<WRDAttributeTypeId.Array, { members: Record<string, SimpleWRDAttributeType | WRDAttrBase> }> |
  WRDAttrBaseGen<WRDAttributeTypeId.JSON, { type: object }> |
  WRDAttrBaseGen<WRDAttributeTypeId.DeprecatedStatusRecord, { allowedValues: string; type: object }>;

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

/** Base type for the type definition of a WRD type or array */
export type TypeDefinition = Record<string, SimpleWRDAttributeType | WRDAttrBase>;

/** Base type for the type definition of a WRD type */
export type RootTypeDefinition = TypeDefinition & WRDTypeBaseSettings;

/** Base type for the type definition of a WRD schema */
export type SchemaTypeDefinition = Record<string, RootTypeDefinition>;

/** All allowed filter conditions */
export type AllowedFilterConditions = "=" | ">=" | ">" | "!=" | "<" | "<=" | "mentions" | "mentionsany" | "in" | "like" | "contains" | "intersects";

/** Base WRD type */
export type WRDTypeBaseSettings = {
  wrdId: IsNonUpdatable<WRDBaseAttributeTypeId.Base_FixedDomain>;
  wrdGuid: ToWRDAttr<WRDBaseAttributeTypeId.Base_Guid>;
  wrdType: IsGenerated<WRDBaseAttributeTypeId.Base_FixedDomain>;
  wrdTag: ToWRDAttr<WRDBaseAttributeTypeId.Base_Tag>;
  wrdCreationDate: ToWRDAttr<WRDBaseAttributeTypeId.Base_CreationLimitDate>;
  wrdLimitDate: ToWRDAttr<WRDBaseAttributeTypeId.Base_CreationLimitDate>;
  wrdModificationDate: ToWRDAttr<WRDBaseAttributeTypeId.Base_ModificationDate>;
};

/** Extracts the select result type for an attribute type */
export type GetResultType<T extends SimpleWRDAttributeType | WRDAttrBase, Export extends boolean> = Awaited<ReturnType<AccessorType<ToWRDAttr<T>>[Export extends true ? "exportValue" : "getValue"]>>;

/** Extracts the default value type for an attribute type */
type GetDefaultType<T extends SimpleWRDAttributeType | WRDAttrBase> = ReturnType<AccessorType<ToWRDAttr<T>>["getDefaultValue"]>;

/** Gives back the allowed condition+value combinations for an attribute type */
export type GetCVPairs<T extends SimpleWRDAttributeType | WRDAttrBase> = Parameters<AccessorType<ToWRDAttr<T>>["checkFilter"]>[0];

/** Gives back the allowed input value type for an attribute type */
export type GetInputType<T extends SimpleWRDAttributeType | WRDAttrBase> =
  //Check ValidateInput's type to retrieve supported directly settable types
  Parameters<AccessorType<ToWRDAttr<T>>["validateInput"]>[0]
  //Is there an importValue?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- val:unknown is too strict to capture callbacks
  | (AccessorType<ToWRDAttr<T>> extends { importValue: (val: any) => unknown } ? Parameters<AccessorType<ToWRDAttr<T>>["importValue"]>[0] : never);

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

/** Type for argumemnts to select, but all arrays converted to records */
export type EnrichRecordOutputMap<T extends TypeDefinition> = { [K: string]: RecordOutputMap<T> };

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

/** Converts an output array to a record output map (with the arrays converted to records) */
export type RecordizeEnrichOutputMap<T extends TypeDefinition, O extends EnrichOutputMap<T>> =
  (O extends Readonly<Array<AttrRef<T>>>
    ? ConvertOutputArray<T, O>
    : (O extends { [K: string]: OutputMap<T> }
      ? { [K in keyof O]: RecordizeOutputMap<T, O[K]> }
      : never));

// Get the attribute def (WRDAttributeType or WRDAttr of a AttrRef)
export type AttrOfAttrRef<T extends TypeDefinition, R extends AttrRef<T>> = T[R];

/** Convert an attribute reference to the selection result type */
export type MapAttrRef<T extends TypeDefinition, R extends AttrRef<T>, Export extends boolean> = GetResultType<AttrOfAttrRef<T, R>, Export>;

/** Convert an attribute reference to the selection result type */
export type MapAttrRefWithDefault<T extends TypeDefinition, R extends AttrRef<T>> = GetDefaultType<AttrOfAttrRef<T, R>>;

/** Calculate the selection result of a record output map */
export type MapRecordOutputMap<T extends TypeDefinition, O extends RecordOutputMap<T>, Export extends boolean> = O extends AttrRef<T>
  ? MapAttrRef<T, O, Export>
  : (O extends { [K: string]: RecordOutputMap<T> }
    ? { -readonly [K in keyof O]: MapRecordOutputMap<T, O[K], Export> }
    : never);

/** Calculate the selection result of a enrichment record output map */
export type MapEnrichRecordOutputMap<T extends TypeDefinition, O extends EnrichRecordOutputMap<T>, Export extends boolean> = O extends { [K: string]: RecordOutputMap<T> }
  ? { -readonly [K in keyof O]: MapRecordOutputMap<T, O[K], Export> }
  : never;

/** Calculate the selection result of a record output map */
export type MapRecordOutputMapWithDefaults<T extends TypeDefinition, O extends RecordOutputMap<T>, Export extends boolean> = O extends AttrRef<T>
  ? MapAttrRefWithDefault<T, O>
  : (O extends { [K: string]: RecordOutputMap<T> }
    ? { -readonly [K in keyof O]: MapRecordOutputMap<T, O[K], Export> }
    : never);

/** Calculate the selection result of a enrichment record output map */
export type MapEnrichRecordOutputMapWithDefaults<T extends TypeDefinition, O extends EnrichRecordOutputMap<T>, Export extends boolean> = O extends { [K: string]: RecordOutputMap<T> }
  ? { -readonly [K in keyof O]: MapRecordOutputMapWithDefaults<T, O[K], Export> }
  : never;

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

/** Converts all arrays in an output map to records
 */
export function recordizeEnrichOutputMap<T extends TypeDefinition, O extends EnrichOutputMap<T>>(o: O): RecordizeEnrichOutputMap<T, O> {
  if (isAttrArrayRef(o)) {
    return recordizeOutputArray(o) as RecordizeEnrichOutputMap<T, O>;
  } else {
    // Need type override here, mapObject can't correctly determine the return type when using generic functions.
    return mapObject(o as { [K: string]: OutputMap<T> }, <V extends OutputMap<T>>(v: V) => recordizeOutputMap(v)) as RecordizeEnrichOutputMap<T, O>;
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

/** Object with all values allowed for an object query */
export type MatchObjectQueryable<T extends TypeDefinition> = { [K in keyof T]?: (GetCVPairs<T[K]> & { condition: "=" })["value"] };

/** Object with all values allowed for an match query within an upsert query */
export type UpsertMatchQueryable<T extends TypeDefinition> = Pick<WRDUpdatable<T>, keyof MatchObjectQueryable<T> & keyof WRDUpdatable<T>> & MatchObjectQueryable<T>;

/** Given an inferred object type O and a contract type Contract, ensure that the resulting type conforms to the contract, and doesn't contain
 * any extra properties. Can be used for inference of an object type parameter in a function call.
 * @typeParam O - The type that will be inferred
 * @typeParam Contract - The contract to ensure the object conforms to
 * @example
 * ```typescript
 * function test<O extends object>(o: EnsureExactForm<O, { a?: number, b?: number }>) { ... }
 * const v = test({a: 1}); // with this call, O is inferred as { a: number }
 * const 2 = test(["a"]); // with this call, O is inferred as ["a"], so the result type is `never`, resulting in an error
 * ```
 */
/* It is better than using test<O extends Contract>(obj: O & Record<Exclude<keyof O, keyof Contract>, never>) because it will disallow arrays too (eg ["a"]). Type inference
   will result in O being inferred to be 'Contract' in that case. If Contract has only optional parameters, the array will conform to the contract */
export type EnsureExactForm<O extends object, Contract extends object> = O & Contract & Record<Exclude<keyof O, keyof Contract>, never>;

type AnyCondition = { field: string; condition: AllowedFilterConditions; value: unknown; options?: { matchCase?: boolean; ignoreAllowedValues?: boolean } };

type ListConditionsSimple<T extends TypeDefinition, Field extends keyof T & string, Base extends string, Filter extends object> = Field extends keyof T & string ?
  (WRDAttributeTypeId extends T[Field] ? // test for 'any'
    AnyCondition :
    { field: `${Base}${Field}` } & GetCVPairs<T[Field]> & Filter |
    (T[Field] extends { __attrtype: WRDAttributeTypeId.Array; __options: { members: infer M extends TypeDefinition } } ?
      ListConditionsSimple<M, keyof M & string, `${Base}${Field}.`, { condition: "mentions" | "mentionsany" }> :
      never)) :
  never;

/** Lists all allowed `{ field, condition, value, options }` pairs for a type */
export type ListConditions<T extends TypeDefinition> = ListConditionsSimple<T, keyof T & string, "", object>;

/** Lists all allowed fields for a `where` clause */
export type WhereFields<T extends TypeDefinition> = ListConditions<T>["field"];

type ListConditionsForField<T extends TypeDefinition, Field extends WhereFields<T>> = (ListConditions<T> & { field: Field });

/** Lists all allowed conditions for a `where` clause and a specified field */
export type WhereConditions<T extends TypeDefinition, Field extends WhereFields<T>> = ListConditionsForField<T, Field>["condition"];

/** Lists all allowed `{ field, condition, value, options }` pairs for a type, a specified field and a specified condition */
export type WhereValueOptions<T extends TypeDefinition, Field extends WhereFields<T>, Condition extends WhereConditions<T, Field>> = ListConditionsForField<T, Field> & { condition: Condition };


type InsertableAndRequired<T extends WRDAttrBase> = T["__required"] extends true ? T["__insertable"] extends true ? true : false : false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- uses any for distribution
type Simplify<T> = T extends any ? { [K in keyof T]: T[K] } : never;

/** Returns the type for date for WRD entity creation */
export type WRDInsertable<T extends TypeDefinition> = Simplify<{
  // Exclude all non-insertable & optional keys by remapping the key value to 'never'. Need to do the tests inline to preserve {[x: string]:any} when T is anyType.
  // TODO want to Simplify< GetInputType for better intelisense but it breaks schema.ts createEntity with stack limit exceeded
  [K in keyof T as ToWRDAttr<T[K]>["__insertable"] extends true ? false extends ToWRDAttr<T[K]>["__required"] ? K : never : never]?: GetInputType<T[K]>
} & {
  // Make sure all members that are insertable and required are added non-optionally. No need to repeat the value type here, that will just merge
  [K in keyof T as InsertableAndRequired<ToWRDAttr<T[K]>> extends true ? K : never]: GetInputType<T[K]>
}>;

/** Returns the type for updating a WRD entity */
export type WRDUpdatable<T extends TypeDefinition> = {
  // Exclude all non-updatable keys by remapping the key value to 'never'
  [K in keyof T as ToWRDAttr<T[K]>["__updatable"] extends true ? K : never]?: GetInputType<T[K]>
};

/** Single row selection result */
export type SelectionResultRow<T extends TypeDefinition, O extends OutputMap<T>, Export extends boolean> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>, Export>;

/** Combines two attributes of a type definition. Two incompatible attributes resolve to never. FIXME: recurse into arrays
*/
export type CombineAttrs<A extends WRDAttrBase, B extends WRDAttrBase> = A extends B ? B extends A ? A : never : never;

/** Combines two types. Two incompatible attributes resolve to never */
export type CombineTypes<A extends RootTypeDefinition, B extends RootTypeDefinition> = Omit<A, keyof B> & Omit<B, keyof A> & {
  [K in keyof A & keyof B]: CombineAttrs<ToWRDAttr<A[K]>, ToWRDAttr<B[K]>>;
} & WRDTypeBaseSettings;

/** Combines two schemas. Two incompatible attributes resolve to never */
export type CombineSchemas<A extends SchemaTypeDefinition, B extends SchemaTypeDefinition> = Omit<A, keyof B> & Omit<B, keyof A> & {
  [K in keyof A & keyof B]: CombineTypes<A[K], B[K]>
};


/** Combines an array with multiple schema types. Also accepts a simple schema, passes it through directly */
export type Combine<S extends SchemaTypeDefinition | SchemaTypeDefinition[]> = S extends [infer A extends SchemaTypeDefinition, infer B extends SchemaTypeDefinition, ...infer C extends SchemaTypeDefinition[]] ? CombineSchemas<A, Combine<[B, ...C]>> : S extends [SchemaTypeDefinition] ? S[0] : S extends SchemaTypeDefinition ? S : never;

export type AnyType = WRDTypeBaseSettings & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'unknown' might be closer but is not accepted by the rest of the WRD definitions
  [key: string]: any;
};

export type AnySchemaTypeDefinition = Record<string, AnyType>;
