//Not yet a public API, so moving this into a separate lib first

import { BridgeService, getBridgeService } from "@webhare/services/src/bridgeservice";
import { openBackendService } from "./backendservice";

export interface JobService {
  //TODO if backendservice becomes a proxy, we can use mixed case here
  INVOKE(library: string, callname: string, args: unknown[]): Promise<unknown>;
  OBJINVOKE(objid: number, callname: string, args: unknown[]): Promise<unknown>;
}

interface MappedObject {
  __type: "object";
  id: number;
}

interface HSCallsProxy {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

export class HSVM {
  bridge: BridgeService;
  job: JobService;

  constructor(bridge: BridgeService, job: JobService) {
    this.bridge = bridge;
    this.job = job;
  }

  async loadlib(name: string): Promise<HSCallsProxy> {
    //We're not async now, but might be in the future...
    const proxy = new Proxy({}, new HSVMLibrary(this, name)) as HSCallsProxy;
    return proxy;
  }

  unmap(data: unknown): unknown {
    if ((data as MappedObject)?.__type === "object") {
      //TODO we could reuse the object if we saw it earlier ?
      const objid = (data as MappedObject).id;
      const proxy = new Proxy({}, new HSVMObject(this, objid));
      return proxy;
    }
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

export class HSVMLibrary {
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
  const servicename = await bridge.OPENHSVM();
  const jobservice = await openBackendService<JobService>(servicename);
  return new HSVM(bridge, jobservice);
}
