/** Recursively converts a type to readonly
 * @typeParam T - Type to convert
*/
export type RecursiveReadonly<T> = T extends Array<infer U> ? ReadonlyArray<RecursiveReadonly<U>> : T extends object ? { readonly [K in keyof T]: RecursiveReadonly<T[K]> } : T;

/** Recursively apply `Partial<>`  on records in a type
 * @typeParam T - Type to convert
*/
export type RecursivePartial<T> = T extends Array<infer U> ? Array<RecursivePartial<U>> : T extends object ? { [K in keyof T]?: RecursivePartial<T[K]> } : T;

/** Convert the return type of a function to a promise
 * Inspired by https://stackoverflow.com/questions/50011616/typescript-change-function-type-so-that-it-returns-new-value
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- using any is needed for this type definition
export type PromisifyFunctionReturnType<T extends (...a: any) => any> = (...a: Parameters<T>) => ReturnType<T> extends (1 & ReturnType<T>) ? Promise<any> : ReturnType<T> extends Promise<any> ? ReturnType<T> : Promise<ReturnType<T>>;
// The above definition use `extends (1 & ReturnType<T>)` to detect 'any'

/** Given a type Contract and a type Actual that extends Contract, returns Contract with
 * properties that are added in Actual with type never. If used in a function signature like
 * this: `<Actual extends Contact>(param: Actual & DisallowExtraPropsRecursive<Actual, Contract>`,
 * this has the effect that extra properties in Actual will be disallowed compile-time.
 */
export type DisallowExtraPropsRecursive<Actual extends Contract, Contract> = Contract extends unknown[]
  ? (Actual extends unknown[]
    ? Array<DisallowExtraPropsRecursive<Actual[number], Contract[number]>>
    : Contract)
  : (Contract extends object
    ? (Actual extends Contract
      ? { [K in keyof Contract]: K extends keyof Actual ? DisallowExtraPropsRecursive<Actual[K], Contract[K]> : Contract[K] } & { [K in Exclude<keyof Actual, keyof Contract>]: never }
      : Contract)
    : Contract);
