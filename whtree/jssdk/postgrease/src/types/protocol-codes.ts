import type { CharToCharCode } from "./char-to-charcode";

export type EncryptionResponseNo = CharToCharCode<'N'>; // 78
export type EncryptionResponseSSL = CharToCharCode<'S'>; // 83
export type EncryptionResponseGSSAPI = CharToCharCode<'G'>; // 71

export type CodeAuthentication = CharToCharCode<'R'>; // 82
export type CodeBackendKeyData = CharToCharCode<'K'>; // 75
export type CodeBind = CharToCharCode<'B'>; // 66
export type CodeBindComplete = CharToCharCode<'2'>; // 50
export type CodeClose = CharToCharCode<'C'>; // 67
export type CodeCloseComplete = CharToCharCode<'3'>; // 51
export type CodeCommandComplete = CharToCharCode<'C'>; // 67
export type CodeCopyData = CharToCharCode<'d'>; // 100
export type CodeCopyDone = CharToCharCode<'c'>; // 99
export type CodeCopyFail = CharToCharCode<'f'>; // 102
export type CodeCopyInResponse = CharToCharCode<'G'>; // 71
export type CodeCopyOutResponse = CharToCharCode<'H'>; // 72
export type CodeCopyBothResponse = CharToCharCode<'W'>; // 87
export type CodeDataRow = CharToCharCode<'D'>; // 68
export type CodeDescribe = CharToCharCode<'D'>; // 68
export type CodeEmptyQueryResponse = CharToCharCode<'I'>; // 73
export type CodeErrorResponse = CharToCharCode<'E'>; // 69
export type CodeExecute = CharToCharCode<'E'>; // 69
export type CodeFlush = CharToCharCode<'H'>; // 72
export type CodeFunctionCall = CharToCharCode<'F'>; // 70
export type CodeFunctionCallResponse = CharToCharCode<'V'>; // 86
export type CodeNegotiateProtocolVersion = CharToCharCode<'v'>; // 118
export type CodeNoData = CharToCharCode<'n'>; // 110
export type CodeNoticeResponse = CharToCharCode<'N'>; // 78
export type CodeNotificationResponse = CharToCharCode<'A'>; // 65
export type CodeParameterDescription = CharToCharCode<'t'>; // 116
export type CodeParameterStatus = CharToCharCode<'S'>; // 83
export type CodeParse = CharToCharCode<'P'>; // 80
export type CodeParseComplete = CharToCharCode<'1'>; // 49
export type CodePasswordMessage = CharToCharCode<'p'>; // 112
export type CodePortalSuspended = CharToCharCode<'s'>; // 115
export type CodeQuery = CharToCharCode<'Q'>; // 81
export type CodeReadyForQuery = CharToCharCode<'Z'>; // 90
export type CodeRowDescription = CharToCharCode<'T'>; // 84
export type CodeSync = CharToCharCode<'S'>; // 83
export type CodeTerminate = CharToCharCode<'X'>; // 88

export type AuthenticationOk = 0;
export type AuthenticationKerberosV5 = 2;
export type AuthenticationCleartextPassword = 3;
export type AuthenticationMD5Password = 5;
export type AuthenticationGSS = 7;
export type AuthenticationGSSContinue = 8;
export type AuthenticationSSPI = 9;
export type AuthenticationSASL = 10;
export type AuthenticationSASLContinue = 11;
export type AuthenticationSASLFinal = 12;

export type TransactionStatusIdle = CharToCharCode<'I'>; // 73
export type TransactionStatusInTransaction = CharToCharCode<'T'>; // 84
export type TransactionStatusInFailedTransaction = CharToCharCode<'E'>; // 69

const names: Record<number, string | [string, string]> = {
  100: "CopyData",
  102: "CopyFail",
  110: "NoData",
  112: "PasswordMessage",
  115: "PortalSuspended",
  116: "ParameterDescription",
  118: "NegotiateProtocolVersion",
  49: "ParseComplete",
  50: "BindComplete",
  51: "CloseComplete",
  65: "NotificationResponse",
  66: "Bind",
  67: ["CommandComplete", "Close"],
  68: ["DataRow", "Describe"],
  69: ["ErrorResponse", "Execute"],
  70: "FunctionCall",
  71: "CopyInResponse",
  72: ["CopyOutResponse", "Flush"],
  73: "EmptyQueryResponse",
  75: "BackendKeyData",
  78: "NoticeResponse",
  80: "Parse",
  81: "Query",
  82: "Authentication",
  83: ["ParameterStatus", "Sync"],
  84: "RowDescription",
  86: "FunctionCallResponse",
  87: "CopyBothResponse",
  88: "Terminate",
  90: "ReadyForQuery",
  99: "CopyDone",
};

export function getCodeName(code: number, backend: boolean): string {
  const name = names[code];
  if (Array.isArray(name))
    return name[backend ? 0 : 1];
  return name;
}
