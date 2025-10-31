import bridge from "@mod-system/js/internal/whmanager/bridge";
import type { IPCLinkType } from "@mod-system/js/internal/whmanager/ipc";
import * as std from "@webhare/std";
import { maxDateTime } from "@webhare/hscompat/src/datetime.ts";
import { checkModuleScopedName } from "./naming";

interface InitTask {
  task: "init";
  clientname: string;
  groupid: string;
}
interface InitResponse {
  status: "ok";
  logtraces: boolean;
}

interface LockTask {
  task: "lock";
  mutexname: string;
  wait_until: Date;
  trace: [];
  trylock: boolean;
}

interface LockResponse {
  status: "ok" | "timeout" | "error" | "no";
}

interface UnlockTask {
  task: "unlock";
  mutexname: string;
}

interface UnlockResponse {
  status: string;
}

export type MutexManagerLinkType = IPCLinkType<InitTask | LockTask | UnlockTask, InitResponse | LockResponse | UnlockResponse>;
export type MutexManagerLink = MutexManagerLinkType["ConnectEndPoint"];

class Mutex {
  private link: MutexManagerLink | null = null;
  public readonly name;

  constructor(mutexmgr: MutexManagerLink, mutexname: string) {
    this.link = mutexmgr;
    this.name = mutexname;
  }
  release(): void {
    // Send an unlock request, don't care about the result (it is ignored by our dorequests)
    if (this.link) {
      this.link.send({ task: "unlock", mutexname: this.name });
      this.link.close();
    }
    this.link = null;
  }
  [Symbol.dispose]() {
    this.release();
  }
}

//Connect, set up IPC port in mutexmanager. TODO: Reuse connections - but this will *also* require us to locally handle mutex conflicts inside our link
async function connectMutexManager(): Promise<MutexManagerLink> {
  const deadline = Date.now() + 60000; //60 seconds from now

  //Wait up to 60 seconds (perhaps a bit more) for the mutexmanager to be reachable.
  //it might be unreachable for a few seconds after a crash or during webhare startup
  do {
    let link;
    try {
      link = bridge.connect<MutexManagerLinkType>("system:mutexmanager", { global: true });
      // link.on("close", function () { // cleanup on disconnect - not after every lock..
      await link.activate();

      const connectrequest = link.doRequest({ task: "init", clientname: "JS clientname", groupid: process.pid + "#" + bridge.getGroupId() });
      await std.wrapInTimeout(connectrequest, 1000, "");
      return link;
    } catch {
      link?.close();
      await std.sleep(100);
    }
  } while (Date.now() < deadline);
  throw new Error("Unable to connect to the mutex manager");
}

export async function lockMutex(name: string): Promise<Mutex>;
export async function lockMutex(name: string, options: { timeout: std.WaitPeriod; __skipNameCheck?: boolean }): Promise<Mutex | null>;
export async function lockMutex(name: string, options: { __skipNameCheck?: boolean }): Promise<Mutex>;

/** Lock the requested mutex
 * @param name - The name of the mutex to lock
 * @param options - timeout optional timeout in milliseconds. If not specified, the mutex will be waited for indefinitely
 * @returns A locked mutex, or null if locking failed due to a timeout
 */
export async function lockMutex(name: string, options?: { timeout?: std.WaitPeriod; __skipNameCheck?: boolean }): Promise<Mutex | null> {
  if (!options?.__skipNameCheck) //We're also invoked by WASM HareScript and WASM HareScript doesn't care about mutex name checks (lenient for old code)
    checkModuleScopedName(name);

  //convert any non-infinite relative timeout to an absolute one
  const opt_timeout = options?.timeout ?? Infinity; //this ensures that '0' stays 0
  const timeout = opt_timeout === Infinity ? Infinity : std.convertWaitPeriodToDate(opt_timeout);

  //TODO should we have a shorter timeout if not connected yet? but that will break a tryLock/timeout:0 as they'd disconect immediately
  const mutexmanager = await connectMutexManager();
  try {
    const trylock = timeout !== Infinity && (timeout as Date).getTime() < Date.now();
    const lockrequest = mutexmanager.doRequest({
      task: "lock",
      mutexname: name,
      trylock: trylock,
      trace: [],
      wait_until: timeout === Infinity ? maxDateTime : timeout as Date
    });

    const lockresult = await lockrequest;
    if (lockresult.status === "timeout" || lockresult.status === "no")
      return null;
    if (lockresult.status === "ok")
      return new Mutex(mutexmanager!, name);

    throw new Error(`Unexpected status '${lockresult.status}' from mutexmanager locking '${name}'`);
  } finally {
    mutexmanager.dropReference();
  }
}

export type { Mutex };
