import * as net from "node:net";
import * as fs from "node:fs";
import { run } from "@webhare/cli";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { formatBufferDump, parsePGProtocolMessage, type ParsedMessage } from "./lib/protocol";


class MessageParser {
  frontend = true;
  authenticated = true;
  requestedSSL = false;
  buf = Buffer.from([]);

  constructor(frontend: boolean) {
    this.frontend = frontend;
    this.authenticated = !frontend;
  }

  parse(data: Buffer, cb: (msg: ParsedMessage) => void) {
    this.buf = Buffer.from([...this.buf, ...data]);

    for (; ;) {
      if (this.requestedSSL && this.buf.length && (this.buf[0] === 0x53 || this.buf[0] === 0x4e)) {
        const useSSL = this.buf[0] === 0x53;
        this.buf = this.buf.subarray(1);
        this.requestedSSL = false;
        cb({
          type: "SSLResponse",
          useSSL
        });
        continue;
      }

      if (this.buf.length < (this.authenticated ? 5 : 4))
        return;

      const code = this.authenticated ? String.fromCharCode(this.buf[0]) : "";
      const len = this.buf.readUInt32BE(this.authenticated ? 1 : 0);

      //log(`parsed '${code}' ${len} in buf of len ${this.buf.length}`);

      const end = len + (this.authenticated ? 1 : 0);

      if (this.buf.length < end)
        return;

      const toParse = this.buf.subarray(this.authenticated ? 5 : 4, end);
      //log(code, this.buf.length, end, toParse.toString("hex"), this.authenticated);
      this.buf = this.buf.subarray(end);

      const res = parsePGProtocolMessage(code, toParse, this.frontend);
      cb(res);
    }
  }

  setAuthenticated() {
    this.authenticated = true;
  }

  setRequestedSSL() {
    this.requestedSSL = true;
  }
}


/*
const encoder: { [K in ParsedMessage as K["type"]]: { len: (msg: K) => number; encode: (msg: K, buf: DataView) => number } } = {
  AuthenticationOk: {
    len: (msg) => 4,
    encode: (msg, buf) => {
      buf.setUint32(0, 0);
      return 0x52; // R
    }
  },
  AuthenticationKerberosV5: {
    len: (msg) => 4,
    encode: (msg, buf) => {
      buf.setUint32(0, 2);
      return 0x52; // R
    }
  },
  AuthenticationCleartextPassword: {
    len: (msg) => 4,
    encode: (msg, buf) => {
      buf.setUint32(0, 3);
      return 0x52; // R
    }
  },
  AuthenticationMD5Password: {
    len: (msg) => 8,
    encode: (msg, buf) => {
      buf.setUint32(0, 5);
      buf.setUint8(4, msg.salt[0]);
      buf.setUint8(5, msg.salt[1]);
      buf.setUint8(6, msg.salt[2]);
      buf.setUint8(7, msg.salt[3]);
      return 0x52; // R












  case 0:
  return {
    type: "AuthenticationOk"
  };
  case 2:
  return {
    type: "AuthenticationKerberosV5"
  };
  case 3:
  return {
    type: "AuthenticationCleartextPassword"
  };
  case 5:
  return {
    type: "AuthenticationMD5Password",
    salt: data.subarray(4, 8)
  };
  case 7:
  return {
    type: "AuthenticationGSS"
  };
  case 8:
  return {
    type: "AuthenticationGSSContinue",
    data: data.subarray(4)
  };
  case 9:
  return {
    type: "AuthenticationSSPI"
  };
  case 10:
  return {
    type: "AuthenticationSASL",
    mechanisms: data.toString("utf8", 4, data.length - 1).split("\0")
  };
  case 11:
  return {
    type: "AuthenticationSASLContinue",
    data: data.subarray(4)
  };
  case 12:
  return {
    type: "AuthenticationSASLFinal",
    data: data.subarray(4)
  };
  default: {
    return {
      type: "AuthenticationUnknown",
      data

  AuthenticationOk: {
        len: (msg) => 5,
        encode: (msg, buf) => {
          buf.setUint8(0, 0x52); // R
          buf.setUint32(1, 0);
        }
      },
      AuthenticationCleartextPassword: {
        len: (msg) => 8,
        encode: (msg, buf) => {
          buf.setUint8(0, 0x52); // R
          buf.setUint32(1, 8);
          buf.setUint32(5, 3);
        };
*/

run({
  description: "Proxy for PostgreSQL connections that dumps the protocol messages.\nUsage: wh run protocol-dump-proxy.ts [ --socket-dir unix-socket-dir ] [command...]",
  options: {
    "socket-dir": { description: "Directory to create the Unix socket in. Defaults to /tmp when not specifying a command. Deletes the socket file when already present in the directory!." },
  },
  arguments: [
    {
      name: "[command...]",
      description: "Command to execute. If provided the command will be executed with WEBHARE_PGHOST set to the socket dir. If no socket dir is provided, a temporary directory will be created."
    }
  ],
  async main({ args, opts }) {
    if (!process.env.PGHOST)
      throw new Error(`Environment variable PGHOST not set`);
    if (!process.env.PGPORT)
      throw new Error(`Environment variable PGPORT not set`);

    let tempDir: string | undefined;
    if (!opts.socketDir) {
      if (args.command.length) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-socket-"));
        opts.socketDir = tempDir;
      } else
        opts.socketDir = "/tmp/";
    }

    // schedule deletion of the temporary directory if created
    using delTempDir = tempDir ? { [Symbol.dispose]: () => fs.rmSync(tempDir, { recursive: true }) } : null;
    void delTempDir;

    const listenSock = path.join(opts.socketDir, `.s.PGSQL.${process.env.PGPORT}`);
    const connectSock = process.env.PGHOST + "/.s.PGSQL." + process.env.PGPORT;

    const log = args.command.length ?
      (...logArgs: unknown[]) => console.error(...logArgs) :
      (...logArgs: unknown[]) => console.log(...logArgs);

    let ctr = 0;

    function dumpBuffer(buf: Buffer) {
      log(formatBufferDump(buf));
    }

    // This server listens on a Unix socket at /var/run/mysocket
    const unixServer = net.createServer(clientConn => {
      const pending = new Array<Buffer>;
      let connected = false;
      const id = ++ctr;

      let clientBytes = 0;
      let clientCalls = 0;
      let dbBytes = 0;
      let dbCalls = 0;

      const clientParser = new MessageParser(true);//pgProtocolParser.Parser();
      const dbParser = new MessageParser(false);//pgProtocolParser.Parser();

      log(`PG conn ${id}: Incoming connection from ${clientConn.remoteAddress}:${clientConn.remotePort}, connecting to ${connectSock}`);

      const dbConn = net.connect(connectSock);
      dbConn.on("connect", () => void (async () => {
        log(`PG conn ${id}: Connected`);
        for (const p of pending)
          dbConn.write(p as unknown as Uint8Array);
        connected = true;
      })());
      dbConn.on("error", () => {
        log(`PG conn ${id}: Error from db socket`);
        clientConn.end();
      });

      dbConn.on("data", data => {
        dbBytes += data.length;
        dbCalls++;
        log(`PG conn ${id}: Received ${data.length} bytes from db socket`);
        dumpBuffer(data);
        clientConn.write(data as unknown as Uint8Array);
        dbParser.parse(data, (msg) => {
          log(`PG conn ${id}:  DB message: ${JSON.stringify(msg)}`);
          if (msg.type === "AuthenticationOk") {
            clientParser.setAuthenticated();
          }
        });
      });
      dbConn.on("end", () => {
        log(`PG conn ${id}: Db socket closed, ${dbBytes} bytes in ${dbCalls} chunks`);
        clientConn.end();
      });

      clientConn.on("data", data => {
        clientBytes += data.length;
        clientCalls++;
        log(`PG conn ${id}: Received ${data.length} bytes from client socket`);
        dumpBuffer(data);
        if (!connected)
          pending.push(data);
        else
          dbConn.write(data as unknown as Uint8Array);
        clientParser.parse(data, (msg) => {
          log(`PG conn ${id}:  Client message: ${JSON.stringify(msg)}`);
          if (msg.type === "SSLRequest")
            dbParser.setRequestedSSL();
        });
      });
      clientConn.on("end", () => {
        log(`PG conn ${id}: Client socket closed, ${clientBytes} bytes in ${clientCalls} chunks`);
        dbConn.end();
      });
    });

    try {
      fs.unlinkSync(listenSock);
    } catch (e) {
      if ((e as Error & { code?: string }).code !== "ENOENT")
        throw e;
    }
    unixServer.listen(listenSock);
    log(`Listening on ${listenSock}`);

    if (args.command.length) {
      const child = spawn("bash", ["-c", `"$0" "$@"`, ...args.command], {
        env: {
          ...process.env,
          WEBHARE_PGHOST: opts.socketDir,
        },
        stdio: ["ignore", "inherit", "inherit"]
      });

      await new Promise<void>(resolve => child.on('close', (code) => {
        if (code !== null)
          process.exitCode = code;
        resolve();
      }));
      unixServer.close();
    } else {
      log(`Execute commands with\nWEBHARE_PGHOST="${opts.socketDir}" command...`);
    }
  }
});
