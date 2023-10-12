export enum WHMRequestOpcode {
  SendEvent = 101,
  RegisterPort = 102,
  UnregisterPort = 103,
  ConnectLink = 104,
  OpenLinkResult = 105,
  DisconnectLink = 106,
  SendMessageOverLink = 107,
  RegisterProcess = 108,
  GetProcessList = 109,
  ConfigureLogs = 110,
  Log = 111,
  Disconnect = 112,
  FlushLog = 113,
  SetSystemConfig = 114,
}

export enum WHMResponseOpcode {
  Answer = 0,                     ///< Normal response to a request
  AnswerException,                ///< Exception has triggered!
  Reset,                          ///< Reset response code (after this code, connection can be reused)
  IncomingEvent = 101,
  RegisterPortResult = 102,
  OpenLink = 103,
  ConnectLinkResult = 104,
  LinkClosed = 105,
  IncomingMessage = 106,
  RegisterProcessResult = 107,
  GetProcessListResult = 108,
  UnregisterPortResult = 109,
  ConfigureLogsResult = 110,
  FlushLogResult = 111,
  SystemConfig = 112
}

export enum WHMProcessType {
  HareScript = 1,
  TypeScript = 2,
}

export type WHMRequest_SendEvent = {
  opcode: WHMRequestOpcode.SendEvent;
  eventname: string;
  eventdata: Buffer | ArrayBuffer;
};
export type WHMRequest_RegisterPort = {
  opcode: WHMRequestOpcode.RegisterPort;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMRequest_UnregisterPort = {
  opcode: WHMRequestOpcode.UnregisterPort;
  portname: string;
  linkid: number;
  msgid: bigint;
  need_unregister_response: boolean;
};
export type WHMRequest_ConnectLink = {
  opcode: WHMRequestOpcode.ConnectLink;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMRequest_OpenLinkResult = {
  opcode: WHMRequestOpcode.OpenLinkResult;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMRequest_DisconnectLink = {
  opcode: WHMRequestOpcode.DisconnectLink;
  linkid: number;
};
export type WHMRequest_SendMessageOverLink = {
  opcode: WHMRequestOpcode.SendMessageOverLink;
  linkid: number;
  msgid: bigint;
  replyto: bigint;
  islastpart: boolean;
  messagedata: Uint8Array | ArrayBuffer;
};
export type WHMRequest_RegisterProcess = {
  opcode: WHMRequestOpcode.RegisterProcess;
  processcode: number;
  pid: number;
  type: WHMProcessType;
  name: string;
  parameters: Record<string, string>;
};
export type WHMRequest_GetProcessList = {
  opcode: WHMRequestOpcode.GetProcessList;
  requestid: number;
};
export type LogFileConfiguration = {
  tag: string;
  logroot: string;
  logname: string;
  logextension: string;
  autoflush: boolean;
  rotates: number;
  timestamps: boolean;
};
export type WHMRequest_ConfigureLogs = {
  opcode: WHMRequestOpcode.ConfigureLogs;
  requestid: number;
  config: LogFileConfiguration[];
};
export type WHMRequest_Log = {
  opcode: WHMRequestOpcode.Log;
  logname: string;
  logline: string;
};
export type WHMRequest_Disconnect = {
  opcode: WHMRequestOpcode.Disconnect;
};
export type WHMRequest_FlushLog = {
  opcode: WHMRequestOpcode.FlushLog;
  requestid: number;
  logname: string;
};
export type WHMRequest_SetSystemConfig = {
  opcode: WHMRequestOpcode.SetSystemConfig;
  systemconfigdata: Buffer | ArrayBuffer;
};

export type WHMRequest = WHMRequest_SendEvent |
  WHMRequest_ConfigureLogs |
  WHMRequest_ConnectLink |
  WHMRequest_OpenLinkResult |
  WHMRequest_Disconnect |
  WHMRequest_DisconnectLink |
  WHMRequest_FlushLog |
  WHMRequest_Log |
  WHMRequest_RegisterPort |
  WHMRequest_RegisterProcess |
  WHMRequest_GetProcessList |
  WHMRequest_SendMessageOverLink |
  WHMRequest_SetSystemConfig |
  WHMRequest_UnregisterPort;

export type WHMResponse_AnswerException = {
  opcode: WHMResponseOpcode.AnswerException;
  exception_code: number;
  exception_text: string;
  exception_table: string;
  exception_column: string;
  exception_clientname: string;
};
export type WHMResponse_IncomingEvent = {
  opcode: WHMResponseOpcode.IncomingEvent;
  eventname: string;
  eventdata: Buffer;
};
export type WHMResponse_RegisterPortResult = {
  opcode: WHMResponseOpcode.RegisterPortResult;
  portname: string;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMResponse_UnregisterPortResult = {
  opcode: WHMResponseOpcode.UnregisterPortResult;
  portname: string;
  linkid: number;
  replyto: bigint;
};
export type WHMResponse_OpenLink = {
  opcode: WHMResponseOpcode.OpenLink;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMResponse_ConnectLinkResult = {
  opcode: WHMResponseOpcode.ConnectLinkResult;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMResponse_LinkClosed = {
  opcode: WHMResponseOpcode.LinkClosed;
  linkid: number;
};
export type WHMResponse_IncomingMessage = {
  opcode: WHMResponseOpcode.IncomingMessage;
  linkid: number;
  msgid: bigint;
  replyto: bigint;
  islastpart: boolean;
  messagedata: Buffer;
};
export type WHMResponse_GetProcessListResult = {
  opcode: WHMResponseOpcode.GetProcessListResult;
  requestid: number;
  processes: Array<{
    processcode: number;
    pid: number;
    type: WHMProcessType;
    name: string;
    parameters: Record<string, string>;
  }>;
};
export type WHMResponse_ConfigureLogsResult = {
  opcode: WHMResponseOpcode.ConfigureLogsResult;
  requestid: number;
  results: boolean[];
};
export type WHMResponse_FlushLogResult = {
  opcode: WHMResponseOpcode.FlushLogResult;
  requestid: number;
  result: boolean;
};
export type WHMResponse_SystemConfig = {
  opcode: WHMResponseOpcode.SystemConfig;
  have_hs_debugger: boolean;
  have_ts_debugger: boolean;
  systemconfigdata: Buffer;
};
export type WHMResponse_RegisterProcessResult = {
  opcode: WHMResponseOpcode.RegisterProcessResult;
  processcode: number;
  have_hs_debugger: boolean;
  have_ts_debugger: boolean;
  systemconfigdata: Buffer;
};

export type WHMResponse =
  WHMResponse_AnswerException |
  WHMResponse_IncomingEvent |
  WHMResponse_RegisterPortResult |
  WHMResponse_UnregisterPortResult |
  WHMResponse_OpenLink |
  WHMResponse_ConnectLinkResult |
  WHMResponse_LinkClosed |
  WHMResponse_IncomingMessage |
  WHMResponse_GetProcessListResult |
  WHMResponse_ConfigureLogsResult |
  WHMResponse_FlushLogResult |
  WHMResponse_SystemConfig |
  WHMResponse_RegisterProcessResult;
