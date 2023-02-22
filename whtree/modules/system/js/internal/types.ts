import { IPCMarshallableData, VariableType } from "./whmanager/hsmarshalling";
import { IPCLinkType } from "./whmanager/ipc";

/// Primitive values (string, number or boolean)
export type PlainValue = string | number | boolean;

/// An object with string keys and typed values
export type KeyValueObject<T> = {
  [key: string]: T;
};

/// An array of name/value pairs
export type Properties = Array<{ name: string; value: string }>;

export interface ServiceInitMessage {
  /** arguments */
  __new: IPCMarshallableData[];
}

export type ServiceCallMessage = {
  /** invoked method */
  call: string;
  /** arguments */
  args?: IPCMarshallableData[];
  /** js encoded args */
  jsargs?: string;
};

export type ServiceCallResult = {
  /** result of invoked method */
  result: IPCMarshallableData;
};

export type WebHareServiceDescription = {
  isjs?: boolean;
  methods: Array<{
    name: string;
    signdata: {
      returntype: number;
      params: Array<{
        type: VariableType;
        has_default: boolean;
      }>;
      excessargstype: number;
    };
  }>;
};

export type WebHareServiceIPCLinkType = IPCLinkType<ServiceInitMessage | ServiceCallMessage, WebHareServiceDescription | ServiceCallResult>;

export interface InspectorSettings {
  url: string;
}
export type BridgeDescription = {
  /** bridge unique ID, in case a process opens multiple connections */
  instance: string;
  /** Process ID */
  pid: number;
  /** Interpreter eg node*/
  interpreter: string;
  /** And the script that's running */
  script: string;
};

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
