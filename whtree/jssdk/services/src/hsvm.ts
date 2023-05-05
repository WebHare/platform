//Not yet a public API, so moving this into a separate lib first

import { BridgeService, getBridgeService } from "@webhare/services/src/bridgeservice";
import { openBackendService, ServiceBase } from "./backendservice";

export interface JobService {
  //TODO if backendservice becomes a proxy, we can use mixed case here
  invoke(library: string, callname: string, args: unknown[]): Promise<unknown>;
  objInvoke(objid: unknown, callname: string, args: unknown[]): Promise<unknown>;
  getNumObjects(): Promise<number>;
  createPrintCallback(text: string): Promise<number>;
  objCleanup(objid: number, generation: number): Promise<never>;
}

interface MappedUnmarshallable {
  __unmarshallable_type: string;
  id: number;
  generation: number;
}

interface HSCallsProxy {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

export type HSVMLibrary = HSCallsProxy;

export type HSVMObject = HSCallsProxy;

export class HSVM {
  bridge: BridgeService;
  job: JobService & ServiceBase;
  unmarshallables: Map<number, { gendata: { generation: number }; weakref: WeakRef<object> }> = new Map;
  finalizer: FinalizationRegistry<{ id: number; gendata: { generation: number } }> | null = null;
  closed = false;

  constructor(bridge: BridgeService, job: JobService & ServiceBase) {
    this.bridge = bridge;
    this.job = job;
  }

  async __getNumRemoteUnmarshallables(): Promise<number> {
    return this.job.getNumObjects();
  }

  async createPrintCallback(text: string): Promise<HSVMUnmarshallable> {
    return this.unmapFromBridge(await this.job.createPrintCallback(text)) as HSVMUnmarshallable;
  }

  async makeObject(objectname: string, ...args: unknown[]): Promise<HSVMObject> {
    return await this.loadlib("wh::system.whlib").makeObject(objectname, ...args) as Promise<HSVMObject>;
  }

  loadlib(name: string): HSCallsProxy {
    const proxy = new Proxy({}, new HSVMLibraryProxy(this, name)) as HSCallsProxy;
    return proxy;
  }

  unmapFromBridge(data: unknown): unknown {
    const bridgetype = (data as MappedUnmarshallable)?.__unmarshallable_type;
    if (!bridgetype)
      return data;

    if (bridgetype === 'undefined') //MACRO call
      return undefined;

    const id = (data as MappedUnmarshallable).id;
    const generation = (data as MappedUnmarshallable).generation;
    const entry = this.unmarshallables.get(id);
    if (entry) {
      const existing = entry.weakref.deref();
      if (existing) {
        if (entry.gendata.generation < generation) {
          // newer generation sent by HareScript, update our generation
          entry.gendata.generation = generation;
        }
        return existing;
      }
    }

    let unmarshallable: object;
    const gendata = { generation };
    if (bridgetype === "OBJECT") {
      const proxy = new HSVMObjectProxy(this, id, gendata);
      unmarshallable = new Proxy({}, proxy);
    } else {
      unmarshallable = new HSVMUnmarshallable(this, bridgetype, id, gendata);
    }

    //Set up a registry to detect object being garbage collected on our side, so we can forward it to HS
    if (!this.finalizer) {
      this.finalizer = new FinalizationRegistry((finalizedata) => this.cleanupObject(finalizedata));
    }

    this.finalizer.register(unmarshallable, { id, gendata });
    this.unmarshallables.set(id, { gendata, weakref: new WeakRef(unmarshallable) });
    return unmarshallable;
  }

  cleanupObject({ id, gendata }: { id: number; gendata: { generation: number } }) {
    if (!this.closed) {
      /* Send the last unmapped generation, a new generation may already be in transit. If the cleanup was
         processed in that case, we would create a new unmarshallable object when the new generation was received,
         but its corresponding mapping on the HareScript side would be gone.
      */
      this.job.objCleanup(id, gendata.generation).catch(() => false); //don't care if this sending fails.

      // also remove entry from unmarshallables, but only if the gendata matches
      const entry = this.unmarshallables.get(id);
      if (entry && entry.gendata === gendata)
        this.unmarshallables.delete(id);
    }
  }

  mapToBridge(arg: unknown) {
    if (arg instanceof HSVMUnmarshallable) {
      if (arg.vm !== this)
        throw new Error(`Unmarshallable used on wrong VM`);
      return { __unmarshallable_type: arg.bridgetype, id: arg.id };
    }

    return arg;
  }

  close() {
    this.closed = true;
    this.job.close();
  }
}

export class HSVMUnmarshallable {
  readonly vm: HSVM;
  readonly id: number;
  readonly bridgetype: string;
  readonly gendata: { generation: number };

  constructor(vm: HSVM, bridgetype: string, id: number, gendata: { generation: number }) {
    this.vm = vm;
    this.id = id;
    this.bridgetype = bridgetype;
    this.gendata = gendata;
  }

}

export class HSVMObjectProxy extends HSVMUnmarshallable {
  constructor(vm: HSVM, objid: number, gendata: { generation: number }) {
    super(vm, "OBJECT", objid, gendata);
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  async invoke(name: string, args: unknown[]) {
    args = args.map(arg => this.vm.mapToBridge(arg));
    return this.vm.unmapFromBridge(await this.vm.job.objInvoke(this.vm.mapToBridge(this), name, args));
  }
}

export class HSVMLibraryProxy {
  private readonly vm: HSVM;
  private readonly lib: string;

  constructor(vm: HSVM, lib: string) {
    this.vm = vm;
    this.lib = lib;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  async invoke(name: string, args: unknown[]) {
    args = args.map(arg => this.vm.mapToBridge(arg));
    return this.vm.unmapFromBridge(await this.vm.job.invoke(this.lib, name, args));
  }
}

export interface HSVMOptions {
  openPrimary?: boolean;
}

export async function openHSVM(options?: HSVMOptions) {
  const bridge = await getBridgeService();
  const servicename = await bridge.openHSVM();
  const jobservice = await openBackendService<JobService>(servicename);
  const hsvm = new HSVM(bridge, jobservice);

  if (options?.openPrimary) {
    const database = hsvm.loadlib("mod::system/lib/database.whlib");
    await database.openPrimary();
  }

  return hsvm;
}
