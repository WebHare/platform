import { getWHType } from "@webhare/std/src/quacks";
import { describeWHFSType } from "@webhare/whfs/src/describe";
import type { ExportedInstance, InstanceSource, TypedInstanceData, ExportedTypedInstance, InstanceData, WHFSTypeName, WHFSTypeInfo, WHFSTypes } from "@webhare/whfs/src/contenttypes";
import { exportData, importData } from "@webhare/whfs/src/codecs";
import type { DisallowExtraPropsRecursive } from "@webhare/js-api-tools/src/utility-types";
import type { ExportOptions, ImportOptions, WebHareDBLocation } from "./descriptor";
import { dbLoc } from "./symbols";
import { SetDataError } from "./codec-support";

export function isInstance(value: unknown): value is Instance {
  return Boolean(value && getWHType(value) === "Instance");
}

class Instance {
  private static "__ $whTypeSymbol" = "Instance";

  #typeInfo: WHFSTypeInfo;
  #data: InstanceData;
  #dbLoc: WebHareDBLocation | null;

  constructor(typeinfo: WHFSTypeInfo, data: InstanceData, loc?: WebHareDBLocation | null) {
    this.#typeInfo = typeinfo;
    this.#data = data;
    this.#dbLoc = loc ?? null;
  }

  get whfsType(): string {
    return this.#typeInfo.scopedType ?? this.#typeInfo.namespace;
  }

  get data(): InstanceData {
    return this.#data;
  }

  get [dbLoc](): WebHareDBLocation | null {
    return this.#dbLoc ?? null;
  }

  async export(options?: ExportOptions): Promise<ExportedInstance> {
    const data = await exportData(this.#typeInfo.members, this.#data, options);
    return {
      whfsType: this.whfsType,
      ...(Object.keys(data).length ? { data } : {}),
    };
  }

  is<Type extends WHFSTypeName>(type: Type | string): this is TypedInstance<Type> {
    return this.#typeInfo.scopedType === type || this.#typeInfo.namespace === type;
  }

  as<Type extends WHFSTypeName>(type: Type): Instance & TypedInstance<Type> {
    if (this.is<Type>(type))
      return this as never; // using 'as never' to avoid a very costly type check in TS;
    throw new Error(`Instance is not of type ${type}`);
  }

  assertType<Type extends WHFSTypeName>(type: Type): asserts this is TypedInstance<Type> {
    if (!this.is<Type>(type))
      throw new Error(`Instance is not of type ${type}`);
  }
}

interface TypedInstanceImpl<Type extends WHFSTypeName> extends Instance {
  get whfsType(): Type;
  get data(): TypedInstanceData<Type>;
  export(options?: ExportOptions): Promise<ExportedTypedInstance<Type>>;
}

// Distribute over WHFSTypeName
export type TypedInstance<Type extends WHFSTypeName> = Type extends WHFSTypeName ? TypedInstanceImpl<Type> : never;

/** @deprecated use Instance instead */
type WidgetInterface = { whfsType: string; data: InstanceData; export(): Promise<ExportedInstance> };

/* The `[Type] extends [symbol] ? Type : ....;` pattern makes sure the Type argument captures the type of the argument , but
   the actual type the argument is checked against is the second part of the conditional - without the actual type influencing the check.
*/

/** Constructs an Instance from source data. If the whfsType is a constant, an instance of that type is returned. The source data won't
 * be type-checked at compile-time if the whfsType has type 'string'.
 */
export async function buildInstance<
  const Type extends string,
  Data extends object,
>(data: ([NoInfer<Type>] extends [symbol] ?
  { whfsType: Type; data?: Data;[dbLoc]?: WebHareDBLocation | null } :
  (string extends NoInfer<Type> ?
    InstanceSource : {
      whfsType: WHFSTypeName;
      data?: ([NoInfer<Type>] extends [WHFSTypeName] ?
        DisallowExtraPropsRecursive<Data, WHFSTypes[NoInfer<Type>]["SetFormat"]> :
        InstanceSource["data"]);
      [dbLoc]?: WebHareDBLocation;
    })),
  options?: ImportOptions): Promise<[NoInfer<Type>] extends [WHFSTypeName] ? TypedInstance<NoInfer<Type>> : Instance> {
  const typeinfo = await describeWHFSType(data.whfsType);
  for (const key of (Object.keys(data)))
    if (key !== "whfsType" && key !== "data")
      throw new Error(`Invalid key '${key}' in instance source, only 'whfsType' and 'data' allowed`);

  let imported;
  try {
    imported = await importData(typeinfo.members, data.data || {}, { ...options, addMissingMembers: true });
  } catch (err) {
    if (err instanceof SetDataError)
      err.prependToPath("data");
    throw err;
  }
  return new Instance(typeinfo, imported, data[dbLoc] ?? null) as [Type] extends [WHFSTypeName] ? TypedInstance<NoInfer<Type>> : Instance;
}

/** @deprecated use buildInstance */
export async function buildWidget(ns: string, data?: object): Promise<WidgetInterface> {
  return buildInstance({ whfsType: ns, data } as InstanceSource);
}

export type { WidgetInterface as Widget, Instance };
