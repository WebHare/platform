import type * as Code from "./types/protocol-codes";
import type { CharToCharCode } from "./types/char-to-charcode";
import type { SocketResponse } from "./socket";
import type { UndocumentedBuffer } from "./types/node-types";

export type AuthenticationOk = {
  type: Code.AuthenticationOk;
};

export type AuthenticationKerberosV5 = {
  type: Code.AuthenticationKerberosV5;
};

export type AuthenticationCleartextPassword = {
  type: Code.AuthenticationCleartextPassword;
};

export type AuthenticationMD5Password = {
  type: Code.AuthenticationMD5Password;
  salt: UndocumentedBuffer;
};

export type AuthenticationGSS = {
  type: Code.AuthenticationGSS;
};

export type AuthenticationGSSContinue = {
  type: Code.AuthenticationGSSContinue;
  authData: UndocumentedBuffer;
};

export type AuthenticationSSPI = {
  type: Code.AuthenticationSSPI;
};

export type AuthenticationSASL = {
  type: Code.AuthenticationSASL;
  mechanisms: string[];
};

export type AuthenticationSASLContinue = {
  type: Code.AuthenticationSASLContinue;
  authData: UndocumentedBuffer;
};

export type AuthenticationSASLFinal = {
  type: Code.AuthenticationSASLFinal;
  additionalData: UndocumentedBuffer;
};

type Authentication =
  | AuthenticationOk
  | AuthenticationKerberosV5
  | AuthenticationCleartextPassword
  | AuthenticationMD5Password
  | AuthenticationGSS
  | AuthenticationGSSContinue
  | AuthenticationSSPI
  | AuthenticationSASL
  | AuthenticationSASLContinue
  | AuthenticationSASLFinal;

export function parseAuthentication(response: SocketResponse): Authentication {
  if (response.dataLen < 4)
    throw new Error("Authentication packet too short");

  const type = response.dataview.getInt32(response.dataStart) as Authentication["type"];
  switch (type) {
    case 0 satisfies Code.AuthenticationOk:
    case 2 satisfies Code.AuthenticationKerberosV5:
    case 3 satisfies Code.AuthenticationCleartextPassword:
    case 7 satisfies Code.AuthenticationGSS:
    case 9 satisfies Code.AuthenticationSSPI:
      return { type };
    case 5 satisfies Code.AuthenticationMD5Password: {
      if (response.dataLen < 8)
        throw new Error("AuthenticationMD5Password packet too short");
      const salt = Uint8Array.prototype.slice.call(response.buffer, response.dataStart + 4, response.dataStart + 8) as UndocumentedBuffer;
      return { type, salt };
    }
    case 8 satisfies Code.AuthenticationGSSContinue:
    case 11 satisfies Code.AuthenticationSASLContinue: {
      const authData = Uint8Array.prototype.slice.call(response.buffer, response.dataStart + 4, response.dataStart + response.dataLen) as UndocumentedBuffer;
      return { type, authData };
    }
    case 10 satisfies Code.AuthenticationSASL: {
      const mechanisms: string[] = [];
      let offset = response.dataStart + 4;
      while (offset < response.dataStart + response.dataLen) {
        const zeroPos = response.buffer.indexOf(0, offset);
        if (zeroPos === offset)
          break;
        mechanisms.push(response.buffer.utf8Slice(offset, zeroPos));
        offset = zeroPos + 1;
      }
      return { type, mechanisms };
    }
    case 12 satisfies Code.AuthenticationSASLFinal: {
      const additionalData = Uint8Array.prototype.slice.call(response.buffer, response.dataStart + 4, response.dataStart + response.dataLen) as UndocumentedBuffer;
      return { type, additionalData };
    }
    default:
      throw new Error(`Unsupported authentication type: ${type}`);
  }
}

export type BackendKeyData = {
  processId: number;
  secretKey: UndocumentedBuffer; // Int32 in v3.0, multi-length in v3.2
};

export function parseBackendKeyData(packet: SocketResponse): BackendKeyData {
  if (packet.dataLen < 8)
    throw new Error("BackendKeyData packet too short");

  const processId = packet.dataview.getInt32(packet.dataStart);
  const secretKey = Uint8Array.prototype.slice.call(packet.buffer, packet.dataStart + 4, packet.dataStart + packet.dataLen) as UndocumentedBuffer;

  return { processId, secretKey };
}

function parseEmpty(packet: SocketResponse): object {
  if (packet.dataLen !== 0)
    throw new Error(`Unexpected data in packet, expected 0 bytes but got ${packet.dataLen}`);
  return {};
}

export const parseBindComplete = parseEmpty;

export const parseCloseComplete = parseEmpty;


export function parseCommandComplete(packet: SocketResponse): string {
  return packet.buffer.utf8Slice(packet.dataStart, packet.dataStart + packet.dataLen);
}

// TODO: CopyData, copyDone, CopyInResponse, CopyOutResponse, CopyBothResponse, DataRow

export const parseEmptyQueryResponse = parseEmpty;

const ErrorFieldTypes = {
  [83 satisfies CharToCharCode<'S'>]: 'severityLocalized',
  [86 satisfies CharToCharCode<'V'>]: 'severity',
  [67 satisfies CharToCharCode<'C'>]: 'code',
  [77 satisfies CharToCharCode<'M'>]: 'message',
  [68 satisfies CharToCharCode<'D'>]: 'detail',
  [72 satisfies CharToCharCode<'H'>]: 'hint',
  [80 satisfies CharToCharCode<'P'>]: 'position',
  [112 satisfies CharToCharCode<'p'>]: 'internalPosition',
  [113 satisfies CharToCharCode<'q'>]: 'internalQuery',
  [87 satisfies CharToCharCode<'W'>]: 'where',
  [115 satisfies CharToCharCode<'s'>]: 'schema',
  [116 satisfies CharToCharCode<'t'>]: 'table',
  [99 satisfies CharToCharCode<'c'>]: 'column',
  [100 satisfies CharToCharCode<'d'>]: 'dataType',
  [110 satisfies CharToCharCode<'n'>]: 'constraint',
  [70 satisfies CharToCharCode<'F'>]: 'file',
  [76 satisfies CharToCharCode<'L'>]: 'line',
  [82 satisfies CharToCharCode<'R'>]: 'routine',
} as const;

type Simplify<T> = { [K in keyof T]: T[K] };

export type ErrorResponse = Simplify<{ [K in typeof ErrorFieldTypes[keyof typeof ErrorFieldTypes]]?: string } & {
  code: unknown;
  message: unknown;
  severity: "ERROR" | "FATAL" | "PANIC";
}>;

export function parseErrorResponse(packet: SocketResponse): ErrorResponse {
  const error: Partial<ErrorResponse> = {};
  let offset = packet.dataStart;
  while (offset < packet.dataStart + packet.dataLen) {
    const fieldTypeChar = packet.buffer[offset] as keyof typeof ErrorFieldTypes | 0;
    offset += 1;
    if (!fieldTypeChar)
      break;
    const zeroPos = packet.buffer.indexOf(0, offset);
    const fieldValue = packet.buffer.utf8Slice(offset, zeroPos);
    offset = zeroPos + 1;

    // ADDME: convert pPL to number?

    const fieldName = ErrorFieldTypes[fieldTypeChar];
    if (fieldName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- severity is an enum, we're not checking its contents for perf reasons.
      error[fieldName] = fieldValue as any;
    }
  }
  return error as ErrorResponse;
}

export type FunctionCallResponse = {
  result: UndocumentedBuffer | null;
};

export function parseFunctionCallResponse(packet: SocketResponse): FunctionCallResponse {
  if (packet.dataLen < 4)
    throw new Error("FunctionCallResponse packet too short");

  const resultLen = packet.dataview.getInt32(packet.dataStart);
  if (resultLen === -1)
    return { result: null };
  if (packet.dataLen < 4 + resultLen)
    throw new Error("FunctionCallResponse packet too short for result data");

  const result = Uint8Array.prototype.slice.call(packet.buffer, packet.dataStart + 4, packet.dataStart + 4 + resultLen) as UndocumentedBuffer;
  return { result };
}

export type NegotiateProtocolVersion = {
  version: number;
  unrecognizedOptions: string[];
};

export function parseNegotiateProtocolVersion(packet: SocketResponse): NegotiateProtocolVersion {
  if (packet.dataLen < 8)
    throw new Error("NegotiateProtocolVersion packet too short");

  const version = packet.dataview.getInt32(packet.dataStart);
  const unrecognizedOptionsLen = packet.dataview.getInt32(packet.dataStart + 4);
  const unrecognizedOptions: string[] = [];
  let offset = packet.dataStart + 8;
  for (let idx = 0; idx < unrecognizedOptionsLen; ++idx) {
    const zeroPos = packet.buffer.indexOf(0, offset);
    if (zeroPos === -1 || zeroPos >= packet.dataStart + packet.dataLen)
      throw new Error("NegotiateProtocolVersion packet malformed");
    unrecognizedOptions.push(packet.buffer.utf8Slice(offset, zeroPos));
    offset = zeroPos + 1;
  }
  return { version, unrecognizedOptions };
}

export const parseNoData = parseEmpty;

export type NoticeResponse = Simplify<{ [K in typeof ErrorFieldTypes[keyof typeof ErrorFieldTypes]]?: string } & {
  severity: "WARNING" | "NOTICE" | "DEBUG" | "INFO" | "LOG";
}>;

export const parseNoticeResponse = parseErrorResponse as unknown as (packet: SocketResponse) => NoticeResponse;

export type NotificationResponse = {
  processId: number;
  channel: string;
  payload: string;
};

export function parseNotificationResponse(packet: SocketResponse): NotificationResponse {
  if (packet.dataLen < 6)
    throw new Error("NotificationResponse packet too short");

  const processId = packet.dataview.getInt32(packet.dataStart);
  let offset = packet.dataStart + 4;
  const channelZeroPos = packet.buffer.indexOf(0, offset);
  if (channelZeroPos === -1 || channelZeroPos >= packet.dataStart + packet.dataLen)
    throw new Error("NotificationResponse packet malformed");
  const channel = packet.buffer.utf8Slice(offset, channelZeroPos);
  offset = channelZeroPos + 1;
  const payloadZeroPos = packet.buffer.indexOf(0, offset);
  if (payloadZeroPos === -1 || payloadZeroPos > packet.dataStart + packet.dataLen)
    throw new Error("NotificationResponse packet malformed");
  const payload = packet.buffer.utf8Slice(offset, payloadZeroPos);
  return { processId, channel, payload };
}

export function parseParameterDescription(packet: SocketResponse): number[] {
  if (packet.dataLen < 2)
    throw new Error("ParameterDescription packet too short");

  const paramCount = packet.dataview.getInt16(packet.dataStart);
  const paramOids: number[] = [];
  let offset = packet.dataStart + 2;
  if (paramCount * 4 + 2 > packet.dataLen)
    throw new Error("ParameterDescription packet too short for all parameter OIDs");
  for (let i = 0; i < paramCount; ++i) {
    const oid = packet.dataview.getInt32(offset);
    paramOids.push(oid);
    offset += 4;
  }
  return paramOids;
}

export function parseParameterStatus(packet: SocketResponse): { key: string; value: string } {
  const keyZeroPos = packet.buffer.indexOf(0, packet.dataStart);
  if (keyZeroPos === -1 || keyZeroPos >= packet.dataStart + packet.dataLen)
    throw new Error("ParameterStatus packet malformed");
  const valueZeroPos = packet.buffer.indexOf(0, keyZeroPos + 1);
  if (valueZeroPos === -1 || valueZeroPos > packet.dataStart + packet.dataLen)
    throw new Error("ParameterStatus packet malformed");
  const key = packet.buffer.utf8Slice(packet.dataStart, keyZeroPos);
  const value = packet.buffer.utf8Slice(keyZeroPos + 1, valueZeroPos);
  return { key, value };
}

export const parseParseComplete = parseEmpty;

export const PortalSuspended = parseEmpty;

export type ReadyForQuery = {
  transactionStatus: Code.TransactionStatusIdle | Code.TransactionStatusInTransaction | Code.TransactionStatusInFailedTransaction;
};

export function parseReadyForQuery(packet: SocketResponse): ReadyForQuery {
  if (packet.dataLen !== 1)
    throw new Error("ReadyForQuery packet malformed");
  const transactionStatus = packet.buffer[packet.dataStart];
  if (transactionStatus !== 73 satisfies Code.TransactionStatusIdle &&
    transactionStatus !== 84 satisfies Code.TransactionStatusInTransaction &&
    transactionStatus !== 69 satisfies Code.TransactionStatusInFailedTransaction)
    throw new Error(`ReadyForQuery packet has invalid transaction status: ${String.fromCharCode(transactionStatus)}`);
  return { transactionStatus };
}

// TODO: RowDescription
