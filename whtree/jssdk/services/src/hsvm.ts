//Not yet a public API, so moving this into a separate lib first

import { BridgeService, getBridgeService } from "@webhare/services/src/bridgeservice";
import { openBackendService } from "./backendservice";

export interface JobService {
  //TODO if backendservice becomes a proxy, we can use mixed case here
  INVOKE(library: string, callname: string, args: unknown[]): Promise<unknown>;
  OBJINVOKE(objid: number, callname: string, args: unknown[]): Promise<unknown>;
  GETNUMOBJECTS(): Promise<number>;
  OBJCLEANUP(objid: number): Promise<never>;
}

interface MappedObject {
  __type: "object";
  id: number;
}

interface HSCallsProxy {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

export type HSVMLibrary = HSCallsProxy;

export class HSVM {
  bridge: BridgeService;
  job: JobService;
  objects: Map<number, WeakRef<object>> = new Map;
  finalizer: FinalizationRegistry<number> | null = null;

  constructor(bridge: BridgeService, job: JobService) {
    this.bridge = bridge;
    this.job = job;
  }

  async __getNumRemoteObjects(): Promise<number> {
    return this.job.GETNUMOBJECTS();
  }

  async loadlib(name: string): Promise<HSCallsProxy> {
    //We're not async now, but might be in the future...
    const proxy = new Proxy({}, new HSVMLibraryProxy(this, name)) as HSCallsProxy;
    return proxy;
  }

  private unmapObject(objid: number) {
    let proxy = this.objects.get(objid)?.deref();
    if (proxy)
      return proxy;

    //Set up a registry to detect object being garbage collected on our side, so we can forward it to HS
    if (!this.finalizer) {
      this.finalizer = new FinalizationRegistry((cleanedupobjid: number) => {
        this.job.OBJCLEANUP(cleanedupobjid).catch(() => false); //don't care if this sending fails..
      });
    }

    proxy = new Proxy({}, new HSVMObject(this, objid));
    this.finalizer.register(proxy, objid);
    this.objects.set(objid, new WeakRef(proxy));
    return proxy;
  }

  unmap(data: unknown): unknown {
    if ((data as MappedObject)?.__type === "object")
      return this.unmapObject((data as MappedObject).id);

    return data;
  }
}

export class HSVMObject {
  private readonly vm: HSVM;
  private readonly objid: number;

  constructor(vm: HSVM, objid: number) {
    this.vm = vm;
    this.objid = objid;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  async invoke(name: string, args: unknown[]) {
    return this.vm.unmap(await this.vm.job.OBJINVOKE(this.objid, name, args));
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
    return this.vm.unmap(await this.vm.job.INVOKE(this.lib, name, args));
  }
}

export async function openHSVM() {
  const bridge = await getBridgeService();
  const servicename = await bridge.openHSVM();
  const jobservice = await openBackendService<JobService>(servicename);
  return new HSVM(bridge, jobservice);
}
