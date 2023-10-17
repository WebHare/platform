/** Recursively converts a type to readonly
 * @typeParam T - Type to convert
*/
export type RecursiveReadOnly<T> = T extends Array<infer U> ? ReadonlyArray<RecursiveReadOnly<U>> : T extends object ? { readonly [K in keyof T]: RecursiveReadOnly<T[K]> } : T;
