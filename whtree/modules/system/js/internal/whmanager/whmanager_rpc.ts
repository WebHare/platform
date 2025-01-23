import * as defs from "./whmanager_rpcdefs";
import { LinearBufferReader, LinearBufferWriter } from "./bufs";

class ReadIOBuffer extends LinearBufferReader {
  constructor(_buffer: Buffer) {
    super(_buffer);
    this.readpos = 4;
  }

  getOpcode() {
    return this.buffer.readUInt8(3);
  }
}

class WriteIOBuffer extends LinearBufferWriter {
  constructor() {
    super();
    this.writepos = 4;
  }

  finishForRequesting(opcode: defs.WHMRequestOpcode): Buffer {
    const header = this.writepos + (opcode << 24);
    this.buffer.writeUInt32LE(header, 0);
    return this.finish();
  }
}

export function parseRPC(data: Buffer): defs.WHMResponse {
  const iobuf = new ReadIOBuffer(data);
  const opcode = iobuf.getOpcode() as defs.WHMResponseOpcode;

  switch (opcode) {
    case defs.WHMResponseOpcode.AnswerException: {
      const exception_code = iobuf.readU32();
      const exception_text = iobuf.readString();
      const exception_table = iobuf.readString();
      const exception_column = iobuf.readString();
      const exception_clientname = iobuf.readString();
      return { opcode, exception_code, exception_text, exception_table, exception_column, exception_clientname };
    }
    case defs.WHMResponseOpcode.IncomingEvent: {
      const eventname = iobuf.readString();
      const eventdata = iobuf.readBinary();
      return { opcode, eventname, eventdata };
    }
    case defs.WHMResponseOpcode.RegisterPortResult: {
      const portname = iobuf.readString();
      const linkid = iobuf.readU32();
      const replyto = iobuf.readBigU64();
      const success = iobuf.readBoolean();
      return { opcode, portname, linkid, replyto, success };
    }
    case defs.WHMResponseOpcode.UnregisterPortResult: {
      const portname = iobuf.readString();
      const linkid = iobuf.readU32();
      const replyto = iobuf.readBigU64();
      return { opcode, portname, linkid, replyto };
    }
    case defs.WHMResponseOpcode.OpenLink: {
      const portname = iobuf.readString();
      const linkid = iobuf.readU32();
      const msgid = iobuf.readBigU64();
      return { opcode, portname, linkid, msgid };
    }
    case defs.WHMResponseOpcode.ConnectLinkResult: {
      const linkid = iobuf.readU32();
      const replyto = iobuf.readBigU64();
      const success = iobuf.readBoolean();
      return { opcode, linkid, replyto, success };
    }
    case defs.WHMResponseOpcode.LinkClosed: {
      const linkid = iobuf.readU32();
      return { opcode, linkid };
    }
    case defs.WHMResponseOpcode.IncomingMessage: {
      const linkid = iobuf.readU32();
      const msgid = iobuf.readBigU64();
      const replyto = iobuf.readBigU64();
      const islastpart = iobuf.readBoolean();
      const messagedata = iobuf.readBinary();
      return { opcode, linkid, msgid, replyto, islastpart, messagedata };
    }
    case defs.WHMResponseOpcode.GetProcessListResult: {
      const requestid = iobuf.readU32();
      const count = iobuf.readU32();
      const processes = [];
      for (let i = 0; i < count; ++i) {
        const pid = iobuf.readS32();
        const type = iobuf.readU8() as defs.WHMProcessType;
        const name = iobuf.readString();
        const paramcount = iobuf.readU32();
        const parameters: Record<string, string> = {};
        for (let idx = 0; idx < paramcount; ++idx) {
          const prop = iobuf.readString();
          parameters[prop] = iobuf.readString();
        }
        processes.push({ pid, type, name, parameters });
      }
      return { opcode, requestid, processes };
    }
    case defs.WHMResponseOpcode.ConfigureLogsResult: {
      const requestid = iobuf.readU32();
      const count = iobuf.readU32();
      const results: boolean[] = [];
      for (let i = 0; i < count; ++i)
        results.push(iobuf.readBoolean());
      return { opcode, requestid, results };
    }
    case defs.WHMResponseOpcode.FlushLogResult: {
      const requestid = iobuf.readU32();
      const result = iobuf.readBoolean();
      return { opcode, requestid, result };
    }
    case defs.WHMResponseOpcode.SystemConfig: {
      const have_hs_debugger = iobuf.readBoolean();
      const have_ts_debugger = iobuf.readBoolean();
      const systemconfigdata = iobuf.readBinary();
      return { opcode, have_hs_debugger, have_ts_debugger, systemconfigdata };
    }
    case defs.WHMResponseOpcode.RegisterProcessResult: {
      const have_hs_debugger = iobuf.readBoolean();
      const have_ts_debugger = iobuf.readBoolean();
      const systemconfigdata = iobuf.readBinary();
      return { opcode, have_hs_debugger, have_ts_debugger, systemconfigdata };
    }
    case defs.WHMResponseOpcode.GetPortListResult: {
      const requestid = iobuf.readU32();
      const count = iobuf.readU32();
      const ports = [];
      for (let i = 0; i < count; ++i) {
        const name = iobuf.readString();
        const pid = iobuf.readS32();
        ports.push({ name, pid });
      }
      return { opcode, requestid, ports };
    }
    default: {
      throw new Error(`Cannot decode opcode #${opcode}`);
    }
  }
}

export function createRPC(message: defs.WHMRequest): Buffer {
  const iobuf = new WriteIOBuffer();
  switch (message.opcode) {
    case defs.WHMRequestOpcode.SendEvent: {
      iobuf.writeString(message.eventname);
      iobuf.writeBinary(message.eventdata);
    } break;
    case defs.WHMRequestOpcode.RegisterPort: {
      iobuf.writeString(message.portname);
      iobuf.writeU32(message.linkid);
      iobuf.writeU64(message.msgid);
    } break;
    case defs.WHMRequestOpcode.UnregisterPort: {
      iobuf.writeString(message.portname);
      iobuf.writeU32(message.linkid);
      iobuf.writeU64(message.msgid);
      iobuf.writeBoolean(message.need_unregister_response);
    } break;
    case defs.WHMRequestOpcode.ConnectLink: {
      iobuf.writeString(message.portname);
      iobuf.writeU32(message.linkid);
      iobuf.writeU64(message.msgid);
    } break;
    case defs.WHMRequestOpcode.OpenLinkResult: {
      iobuf.writeU32(message.linkid);
      iobuf.writeU64(message.replyto);
      iobuf.writeBoolean(message.success);
    } break;
    case defs.WHMRequestOpcode.DisconnectLink: {
      iobuf.writeU32(message.linkid);
    } break;
    case defs.WHMRequestOpcode.SendMessageOverLink: {
      iobuf.writeU32(message.linkid);
      iobuf.writeU64(message.msgid);
      iobuf.writeU64(message.replyto);
      iobuf.writeBoolean(message.islastpart);
      iobuf.writeBinary(message.messagedata);
    } break;
    case defs.WHMRequestOpcode.RegisterProcess: {
      iobuf.writeS32(message.pid);
      iobuf.writeU8(message.type);
      iobuf.writeString(message.name);
      const entries = Object.entries(message.parameters);
      iobuf.writeU32(entries.length);
      for (const [prop, value] of entries) {
        iobuf.writeString(prop);
        iobuf.writeString(value);
      }
    } break;
    case defs.WHMRequestOpcode.GetProcessList: {
      iobuf.writeU32(message.requestid);
    } break;
    case defs.WHMRequestOpcode.GetPortList: {
      iobuf.writeU32(message.requestid);
    } break;
    case defs.WHMRequestOpcode.ConfigureLogs: {
      iobuf.writeU32(message.requestid);
      iobuf.writeU32(message.config.length);
      for (const log of message.config) {
        iobuf.writeString(log.tag);
        iobuf.writeString(log.logroot);
        iobuf.writeString(log.logname);
        iobuf.writeString(log.logextension);
        iobuf.writeBoolean(log.autoflush);
        iobuf.writeU32(log.rotates);
        iobuf.writeBoolean(log.timestamps);
      }
    } break;
    case defs.WHMRequestOpcode.Log: {
      iobuf.writeString(message.logname);
      iobuf.writeString(message.logline);
    } break;
    case defs.WHMRequestOpcode.Disconnect: break;
    case defs.WHMRequestOpcode.FlushLog: {
      iobuf.writeU32(message.requestid);
      iobuf.writeString(message.logname);
    } break;
    case defs.WHMRequestOpcode.SetSystemConfig: {
      iobuf.writeBinary(message.systemconfigdata);
    } break;
    default: {
      throw new Error(`Cannot encode opcode #${(message as defs.WHMRequest).opcode}`);
    }
  }
  return iobuf.finishForRequesting(message.opcode);
}
