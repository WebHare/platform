/// Primitive values (string, number or boolean)
export type PlainValue = string | number | boolean;

/// An object with string keys and typed values
export type KeyValueObject<T> =
  {
    [key: string]: T;
  };

/// An array of name/value pairs
export type Properties = Array<{ name: string; value: string }>;
