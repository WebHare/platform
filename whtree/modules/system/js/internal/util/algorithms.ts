import type { RecursiveReadonly } from "@webhare/js-api-tools";

export { pick, omit } from "@webhare/std";

/** Maps every key of an object with a mapping function to a new value
    @typeParam T - Type of the object to map
    @typeParam K - Type of the mapped value
    @param obj - Object to map
    @param mapping - Mapping function
    @returns Mapped object
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapObject<T extends object, N extends (v: T[keyof T], k?: keyof T) => any>(obj: T, mapping: N): { [K in keyof T]: ReturnType<N> } {
  /* Typescript doesn't support higher-order type arguments at the moment, this is the best we can do for now. If N is
     made generic (like <S>(a:s) => dependent type) you will probably get 'unknown' as type determined for S.
  */
  const retval = {} as { [K in keyof T]: ReturnType<N> };
  for (const i in obj) {
    if (Object.hasOwn(obj, i)) {
      retval[i] = mapping(obj[i], i);
    }
  }
  return retval;
}

/** Recursively freezes a value
 * @param value - Value to freeze
 */
export function freezeRecursive<T>(value: T): RecursiveReadonly<T> {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const elt of value)
      freezeRecursive(elt);
  } else if (typeof value === "object" && value) {
    Object.freeze(value);
    for (const v of Object.values(value))
      freezeRecursive(v);
  }
  return value as RecursiveReadonly<T>;
}

/** Returns the list of required keys of an object type
 * @typeParam T - Type to return the required keys of
 */
export type RequiredKeys<T extends object> = keyof { [K in keyof T as object extends Pick<T, K> ? never : K]-?: null } & keyof T;

/** Returns the list of optional keys of an object type
 * @typeParam T - Type to return the optional keys of
 */
export type OptionalKeys<T extends object> = keyof { [K in keyof T as object extends Pick<T, K> ? K : never]-?: null } & keyof T;

/** Returns the result type of a spread combining two types (eg `let a: A, b: B; return { ...a, ...b }`
 * @typeParam A - Type of left value in the spread
 * @typeParam B - Type of right value in the spread
 */
export type Merge<A extends object, B extends object> = Omit<A, RequiredKeys<B>> & B;

/** Simplifies all objects in a union separately (gets rid of the intersections)
 * Using a `A extends object ?` improves type expansion in VS code.
*/
export type Simplify<A extends object> = A extends object ? { [K in keyof A]: A[K] } : never;

/** Builds an object with a present field with a specific value */
type BuildPresentFieldObject<PresentField extends string, PresentFieldValues extends string> = { [K in PresentField]: PresentFieldValues };

type BuildIdCellObject<InRow extends object, IdCellName extends keyof InRow & string> = { [K in IdCellName]: InRow[IdCellName] };

/** Returns the type of an enrichment operation given its type parameters */
export type EnrichmentResult<
  InRow extends object,
  IdCellName extends keyof InRow & string,
  EnrichRow extends object,
  LeftOuterJoin extends object = never,
  RightOuterJoin extends object = never,
  PresentField extends string = never,
> = Promise<([LeftOuterJoin] extends [never] ?
  ([PresentField] extends [never] ?
    Array<Simplify<Merge<InRow, EnrichRow | RightOuterJoin>>> :
    (Array<Simplify<Merge<InRow, EnrichRow & BuildPresentFieldObject<PresentField, "both"> |
      RightOuterJoin & BuildPresentFieldObject<PresentField, "left">>>>)) :
  ([PresentField] extends [never] ?
    Array<Simplify<Merge<InRow, EnrichRow | RightOuterJoin> | Merge<Merge<BuildIdCellObject<InRow, IdCellName>, LeftOuterJoin>, EnrichRow>>> :
    (Array<Simplify<Merge<InRow, EnrichRow & BuildPresentFieldObject<PresentField, "both"> |
      RightOuterJoin & BuildPresentFieldObject<PresentField, "left">> |
      Merge<Merge<BuildIdCellObject<InRow, IdCellName>, LeftOuterJoin>, EnrichRow & BuildPresentFieldObject<PresentField, "right">>>>)))>;

/** Enrich a list of objects array
    @param inRows - Source objects to enrich
    @param idCellName - Id cell in rows to enrich
    @param options - Options
    <ul>
      <li>presentfield: If set, this field will contain 'left', 'right' or 'both' depending on which records were present</li>
    </ul>
    @param getBulkFields - Function to call to get data to enrich the inrows with.
        Signature: RECORD ARRAY FUNCTION function_ptr(VARIANT idcellvalues, BOOLEAN leftouterjoin, BOOLEAN matchcase).
        Needs to return a record array with a cell '__joinId' which is used to match the enrich rows to the source rows
    @param getLeftOuterJoinValue - If set, enable a left outer join. must return a default row to use for right outer joins with missing enrich row.
      The `[idCellName]` property will be added with the value from the `__joinId` property (unless a property with that name `[idCellName]` is already
      present in the row returned by getBulkFields.
    @param getRightOuterJoinValue - If set, enable a right outer join. must return a default row to use for right outer joins with missing enrich row.
    @returns Enriched rows
*/
export async function executeEnrichment<
  InRow extends object,
  IdCellName extends keyof InRow & string,
  EnrichRow extends object,
  LeftOuterJoin extends object = never,
  RightOuterJoin extends object = never,
  PresentField extends string = never,
>(
  inRows: readonly InRow[],
  idCellName: IdCellName,
  options: { wrapfields?: string; presentfield?: PresentField },
  getBulkFields: (idCellValues: Array<InRow[IdCellName]>, leftOuterJoin: boolean, matchCase: boolean) => Promise<Map<InRow[IdCellName], EnrichRow>> | Map<InRow[IdCellName], EnrichRow>,
  getLeftOuterJoinValue: (() => LeftOuterJoin | Promise<LeftOuterJoin>) | null,
  getRightOuterJoinValue: (() => RightOuterJoin | Promise<RightOuterJoin>) | null
): EnrichmentResult<InRow, IdCellName, EnrichRow, LeftOuterJoin, RightOuterJoin, PresentField> {
  // Early out when no results will be found
  if (!inRows.length && !getLeftOuterJoinValue)
    return [];

  // Gather the ids of the join key
  const getIds = [...new Set(inRows.map(row => row[idCellName]))].sort();

  // Retrieve the fields, dump them into a map from join key to record with the joinkey removed
  const inputMap = await getBulkFields(getIds, Boolean(getLeftOuterJoinValue), false);

  // store for the default values (when having a right outer join)
  let rightOuterJoinValue: RightOuterJoin | undefined;

  // store for used rows (used for leftOuterJoins)
  let used: Set<EnrichRow> | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- could not find a way to get the following done type-safely
  const outRows = new Array<any>;
  for (const inRow of inRows) {
    const lookUp = inRow[idCellName];
    const matchRow = inputMap.get(lookUp);
    if (!matchRow) {
      // No matching row found, try if a rightOuterJoin is requested
      if (!getRightOuterJoinValue)
        continue;
      const defaultRow = (rightOuterJoinValue ??= await getRightOuterJoinValue());
      outRows.push({
        ...inRow,
        ...defaultRow,
        ...(options.presentfield !== undefined ? { [options.presentfield]: "left" } as const : null)
      });
    } else {
      // Found a matching row. Record it if we are doing a left outer join
      if (getLeftOuterJoinValue)
        (used ??= new Set).add(matchRow);
      outRows.push({
        ...inRow,
        ...matchRow,
        ...(options.presentfield !== undefined ? { [options.presentfield]: "both" } as const : null)
      });
    }
  }

  if (getLeftOuterJoinValue) {
    let leftOuterJoinValue: LeftOuterJoin | undefined;
    const defaultRow = (leftOuterJoinValue ??= await getLeftOuterJoinValue());

    for (const [__joinId, inputRow] of inputMap.entries()) {
      if (used?.has(inputRow))
        continue;
      outRows.push({
        [idCellName]: __joinId,
        ...defaultRow,
        ...inputRow,
        ...(options.presentfield !== undefined ? { [options.presentfield]: "right" } as const : null)
      });
    }
  }

  return outRows;
}
