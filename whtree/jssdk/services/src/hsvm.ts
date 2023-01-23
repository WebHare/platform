//Not yet a public API, so moving this into a separate lib first

import { BridgeService, getBridgeService } from "@webhare/services/src/bridgeservice";
import { openBackendService } from "./backendservice";

export interface JobService {
  //TODO if backendservice becomes a proxy, we can use mixed case here
  invoke(library: string, callname: string, args: unknown[]): Promise<unknown>;
  objInvoke(objid: unknown, callname: string, args: unknown[]): Promise<unknown>;
  getNumObjects(): Promise<number>;
  createPrintCallback(text: string): Promise<number>;
  objCleanup(objid: number): Promise<never>;
}

interface MappedUnmarshallable {
  __unmarshallable_type: string;
  id: number;
}

interface HSCallsProxy {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

export type HSVMLibrary = HSCallsProxy;

export type HSVMObject = HSCallsProxy;

export class HSVM {
  bridge: BridgeService;
  job: JobService;
  unmarshallables: Map<number, WeakRef<HSVMUnmarshallable>> = new Map;
  finalizer: FinalizationRegistry<number> | null = null;

  constructor(bridge: BridgeService, job: JobService) {
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
    const existing = this.unmarshallables.get(id)?.deref();
    if (existing)
      return existing;

    let unmarshallable = new HSVMUnmarshallable(this, bridgetype, id);
    if (bridgetype === "OBJECT") {
      unmarshallable = new Proxy<HSVMUnmarshallable>(unmarshallable, new HSVMObjectProxy(this, id));
    }

    //Set up a registry to detect object being garbage collected on our side, so we can forward it to HS
    if (!this.finalizer) {
      this.finalizer = new FinalizationRegistry((cleanedupobjid: number) => {
        this.job.objCleanup(cleanedupobjid).catch(() => false); //don't care if this sending fails..
      });
    }

    this.finalizer.register(unmarshallable, id);
    return unmarshallable;
  }
}

export class HSVMUnmarshallable {
  readonly vm: HSVM;
  readonly id: number;
  readonly bridgetype: string;

  constructor(vm: HSVM, bridgetype: string, id: number) {
    this.vm = vm;
    this.id = id;
    this.bridgetype = bridgetype;
  }

}

export class HSVMObjectProxy extends HSVMUnmarshallable {
  constructor(vm: HSVM, objid: number) {
    super(vm, "OBJECT", objid);
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  async invoke(name: string, args: unknown[]) {
    args = args.map(mapToBridge);
    return this.vm.unmapFromBridge(await this.vm.job.objInvoke(mapToBridge(this), name, args));
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
    args = args.map(mapToBridge);
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

function mapToBridge(arg: unknown) {
  if (arg instanceof HSVMUnmarshallable) {
    return { __unmarshallable_type: arg.bridgetype, id: arg.id };
  }

  return arg;
}
