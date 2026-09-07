export const WHMRequestOpcode = {
  SendEvent: 101,
  RegisterPort: 102,
  UnregisterPort: 103,
  ConnectLink: 104,
  OpenLinkResult: 105,
  DisconnectLink: 106,
  SendMessageOverLink: 107,
  RegisterProcess: 108,
  GetProcessList: 109,
  ConfigureLogs: 110,
  Log: 111,
  Disconnect: 112,
  FlushLog: 113,
  SetSystemConfig: 114,
  GetPortList: 115,
  FenceEvents: 116,
} as const;
export type WHMRequestOpcode = typeof WHMRequestOpcode[keyof typeof WHMRequestOpcode];

export const WHMResponseOpcode = {
  Answer: 0,                     ///< Normal response to a request
  AnswerException: 1,                ///< Exception has triggered!
  Reset: 2,                          ///< Reset response code (after this code, connection can be reused)
  IncomingEvent: 101,
  RegisterPortResult: 102,
  OpenLink: 103,
  ConnectLinkResult: 104,
  LinkClosed: 105,
  IncomingMessage: 106,
  RegisterProcessResult: 107,
  GetProcessListResult: 108,
  UnregisterPortResult: 109,
  ConfigureLogsResult: 110,
  FlushLogResult: 111,
  SystemConfig: 112,
  GetPortListResult: 113,
  FenceEventsResult: 114,
} as const;
export type WHMResponseOpcode = typeof WHMResponseOpcode[keyof typeof WHMResponseOpcode];

export const WHMProcessType = {
  HareScript: 1,
  TypeScript: 2,
} as const;
export type WHMProcessType = typeof WHMProcessType[keyof typeof WHMProcessType];

export type WHMRequest_SendEvent = {
  opcode: typeof WHMRequestOpcode.SendEvent;
  eventname: string;
  eventdata: Buffer<ArrayBuffer> | ArrayBuffer;
};
export type WHMRequest_RegisterPort = {
  opcode: typeof WHMRequestOpcode.RegisterPort;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMRequest_UnregisterPort = {
  opcode: typeof WHMRequestOpcode.UnregisterPort;
  portname: string;
  linkid: number;
  msgid: bigint;
  need_unregister_response: boolean;
};
export type WHMRequest_ConnectLink = {
  opcode: typeof WHMRequestOpcode.ConnectLink;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMRequest_OpenLinkResult = {
  opcode: typeof WHMRequestOpcode.OpenLinkResult;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMRequest_DisconnectLink = {
  opcode: typeof WHMRequestOpcode.DisconnectLink;
  linkid: number;
};
export type WHMRequest_SendMessageOverLink = {
  opcode: typeof WHMRequestOpcode.SendMessageOverLink;
  linkid: number;
  msgid: bigint;
  replyto: bigint;
  islastpart: boolean;
  messagedata: Uint8Array<ArrayBuffer> | ArrayBuffer;
};
export type WHMRequest_RegisterProcess = {
  opcode: typeof WHMRequestOpcode.RegisterProcess;
  pid: number;
  type: typeof WHMProcessType[keyof typeof WHMProcessType];
  name: string;
  parameters: Record<string, string>;
};
export type WHMRequest_GetProcessList = {
  opcode: typeof WHMRequestOpcode.GetProcessList;
  requestid: number;
};
export type WHMRequest_GetPortList = {
  opcode: typeof WHMRequestOpcode.GetPortList;
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
  opcode: typeof WHMRequestOpcode.ConfigureLogs;
  requestid: number;
  config: LogFileConfiguration[];
};
export type WHMRequest_Log = {
  opcode: typeof WHMRequestOpcode.Log;
  logname: string;
  logline: string;
};
export type WHMRequest_Disconnect = {
  opcode: typeof WHMRequestOpcode.Disconnect;
};
export type WHMRequest_FlushLog = {
  opcode: typeof WHMRequestOpcode.FlushLog;
  requestid: number;
  logname: string;
};
export type WHMRequest_SetSystemConfig = {
  opcode: typeof WHMRequestOpcode.SetSystemConfig;
  systemconfigdata: Buffer<ArrayBuffer> | ArrayBuffer;
};
export type WHMRequest_FenceEvents = {
  opcode: typeof WHMRequestOpcode.FenceEvents;
  requestid: number;
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
  WHMRequest_UnregisterPort |
  WHMRequest_GetPortList |
  WHMRequest_FenceEvents;

export type WHMResponse_AnswerException = {
  opcode: typeof WHMResponseOpcode.AnswerException;
  exception_code: number;
  exception_text: string;
  exception_table: string;
  exception_column: string;
  exception_clientname: string;
};
export type WHMResponse_IncomingEvent = {
  opcode: typeof WHMResponseOpcode.IncomingEvent;
  eventname: string;
  eventdata: Buffer<ArrayBuffer>;
};
export type WHMResponse_RegisterPortResult = {
  opcode: typeof WHMResponseOpcode.RegisterPortResult;
  portname: string;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMResponse_UnregisterPortResult = {
  opcode: typeof WHMResponseOpcode.UnregisterPortResult;
  portname: string;
  linkid: number;
  replyto: bigint;
};
export type WHMResponse_OpenLink = {
  opcode: typeof WHMResponseOpcode.OpenLink;
  portname: string;
  linkid: number;
  msgid: bigint;
};
export type WHMResponse_ConnectLinkResult = {
  opcode: typeof WHMResponseOpcode.ConnectLinkResult;
  linkid: number;
  replyto: bigint;
  success: boolean;
};
export type WHMResponse_LinkClosed = {
  opcode: typeof WHMResponseOpcode.LinkClosed;
  linkid: number;
};
export type WHMResponse_IncomingMessage = {
  opcode: typeof WHMResponseOpcode.IncomingMessage;
  linkid: number;
  msgid: bigint;
  replyto: bigint;
  islastpart: boolean;
  messagedata: Buffer<ArrayBuffer>;
};
export type WHMResponse_GetProcessListResult = {
  opcode: typeof WHMResponseOpcode.GetProcessListResult;
  requestid: number;
  processes: Array<{
    pid: number;
    type: WHMProcessType;
    name: string;
    parameters: Record<string, string>;
  }>;
};
export type WHMResponse_ConfigureLogsResult = {
  opcode: typeof WHMResponseOpcode.ConfigureLogsResult;
  requestid: number;
  results: boolean[];
};
export type WHMResponse_FlushLogResult = {
  opcode: typeof WHMResponseOpcode.FlushLogResult;
  requestid: number;
  result: boolean;
};
export type WHMResponse_SystemConfig = {
  opcode: typeof WHMResponseOpcode.SystemConfig;
  have_hs_debugger: boolean;
  have_ts_debugger: boolean;
  systemconfigdata: Buffer<ArrayBuffer>;
};
export type WHMResponse_RegisterProcessResult = {
  opcode: typeof WHMResponseOpcode.RegisterProcessResult;
  have_hs_debugger: boolean;
  have_ts_debugger: boolean;
  systemconfigdata: Buffer<ArrayBuffer>;
};
export type WHMResponse_GetPortListResult = {
  opcode: typeof WHMResponseOpcode.GetPortListResult;
  requestid: number;
  ports: Array<{
    name: string;
    pid: number;
  }>;
};
export type WHMResponse_FenceEventsResult = {
  opcode: typeof WHMResponseOpcode.FenceEventsResult;
  requestid: number;
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
  WHMResponse_RegisterProcessResult |
  WHMResponse_GetPortListResult |
  WHMResponse_FenceEventsResult;
