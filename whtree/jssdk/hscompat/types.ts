type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
  ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
  : Lowercase<S>;

export type KeysToCamelCase<T> = {
  [K in keyof T as CamelCase<string & K>]: T[K]
};

type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}` ?
  `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${CamelToSnakeCase<U>}` :
  S;

export type KeysToSnakeCase<T> = {
  [K in keyof T as CamelToSnakeCase<string & K>]: T[K]
};

export function snakeToCamelCase(tag: string) {
  return tag.replaceAll(/_[a-z]/g, c => c[1].toUpperCase());
}
export function camelToSnakeCase(tag: string) {
  return tag.replaceAll(/[A-Z]/g, c => '_' + c.toLowerCase());
}

export function toSnakeCase<T extends object>(inp: T[]): Array<KeysToSnakeCase<T>>;
export function toSnakeCase<T extends object>(inp: T): KeysToSnakeCase<T>;

export function toSnakeCase<T extends object>(inp: T | T[]): KeysToSnakeCase<T> | Array<KeysToSnakeCase<T>> {
  if (Array.isArray(inp))
    return inp.map(toSnakeCase) as Array<KeysToSnakeCase<T>>;

  return Object.fromEntries(Object.entries(inp).map(([key, value]) => [camelToSnakeCase(key), value])) as KeysToSnakeCase<T>;
}

export function toCamelCase<T extends object>(inp: T[]): Array<KeysToCamelCase<T>>;
export function toCamelCase<T extends object>(inp: T): KeysToCamelCase<T>;

export function toCamelCase<T extends object>(inp: T | T[]): KeysToCamelCase<T> | Array<KeysToCamelCase<T>> {
  if (Array.isArray(inp))
    return inp.map(toCamelCase) as Array<KeysToCamelCase<T>>;

  return Object.fromEntries(Object.entries(inp).map(([key, value]) => [snakeToCamelCase(key), value])) as KeysToCamelCase<T>;
}
