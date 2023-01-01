/// Primitive values (string, number or boolean)
export type PlainValue = string | number | boolean;

/// An object with string keys and typed values
export type KeyValueObject<T> =
  {
    [key: string]: T;
  };

/// An array of name/value pairs
export type Properties = Array<{ name: string; value: string }>;

/// A deferred promise with typed result value
export type DeferredPromise<T> =
  {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason: Error) => void;
  };

export interface ServiceCallMessage {
  /** invoked method */
  call: string;
  /** arguments */
  args?: unknown[];
  /** js encoded args */
  jsargs?: string;
}

export interface WebHareServiceDescription {
  isjs?: boolean;
  methods: Array<{
    name: string;
    signdata: { returntype: number; params: object[]; excessargstype: number };
  }>;
}

export interface InspectorSettings {
  url: string;
}
export interface BridgeDescription {
  /** bridge unique ID, in case a process opens multiple connections */
  instance: string;
  /** Process ID */
  pid: number;
  /** Interpreter eg node*/
  interpreter: string;
  /** And the script that's running */
  script: string;
}
export interface BridgeManagerLink {
  /** List all bridge connections */
  listConnections(): Promise<BridgeDescription[]>;
  /** Enable inspector and get its connection settings for a specific proces */
  enableInspector(instance: string): Promise<InspectorSettings | null>;
}

export interface BridgeClientLink {
  /** Enable inspector and get its connection settings for a specific proces */
  enableInspector(): Promise<InspectorSettings | null>;
}
