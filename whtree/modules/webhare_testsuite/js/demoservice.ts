import type { ServiceClientFactoryFunction } from '@webhare/services/src/backendservicerunner';
import { BackendServiceConnection, BackendServiceController, broadcast } from "@webhare/services";
import type { SimpleMarshallableRecord } from '@mod-system/js/internal/whmanager/hsmarshalling';

class Controller implements BackendServiceController {
  dummy = "-1";
  connections = new Map<string, ClusterTestLink>;

  async createClient(testdata: string) {
    await Promise.resolve(); //wait a tick
    return new ClusterTestLink(this, testdata);
  }
}

class ClusterTestLinkBase extends BackendServiceConnection {
  //we're here to verify that overriding methods doesn't break anything
  ping(arg1: unknown, arg2: unknown) {
    return { arg2, arg1 };
  }
}

class ClusterTestLink extends ClusterTestLinkBase {
  dummy = "42";
  mainobject: Controller | null;
  // null-likes completely broke interface description earlier, so test them specifically
  aNull = null;
  anUndefined = undefined;
  testdata;

  constructor(maininstance: Controller | null, testdata: string) {
    super();
    if (testdata === "abort")
      throw new Error("abort");

    this.testdata = testdata;
    this.mainobject = maininstance;
    this.mainobject?.connections.set(testdata, this);
  }

  ping(arg1: unknown, arg2: unknown) {
    return { arg1, arg2 };
  }
  async asyncPing(arg1: unknown, arg2: unknown) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { arg1, arg2 };
  }
  getLUE() {
    return 42;
  }
  voidReturn() {
  }
  async getAsyncLUE() {
    await new Promise(resolve => setTimeout(resolve, 50));
    return 42;
  }
  crash() {
    throw new Error("Crash()");
  }
  async getAsyncCrash() {
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      throw new Error("Async crash()");
    } catch (e) {
      return Promise.reject(e);
    }
  }
  async _invisible() {
    return true;
  }

  getShared() {
    return this.mainobject?.dummy ?? "-1";
  }
  setShared(val: string) {
    if (!this.mainobject)
      throw new Error("This is not the controlleddemoservice");

    this.mainobject.dummy = val;
    return null; //FIXME marshalling cannot deal with service APIs returning undefined
  }
  emitIPCEvent(name: string, data: unknown) {
    broadcast(name, data as SimpleMarshallableRecord); //FIXME shouldn't need an internal type to broadcast...
  }
  emitTestEvent(data: { start: number; add: number }) {
    this.emit("testevent", data.start + data.add);

    return null;
  }
  getConnections(): string[] {
    return [...this.mainobject?.connections.keys() ?? []].toSorted();
  }
  closeConnection(name: string) {
    if (!this.mainobject?.connections.has(name))
      throw new Error("No such connection");
    this.mainobject?.connections.get(name)?.[Symbol.dispose]();
  }
  onClose() {
    this.mainobject?.connections.delete(this.testdata);
  }

  //Even defining these methods shouldn't expose them to the client
  emit(event: string, data: unknown) {
    super.emit(event, data);
  }
  [Symbol.dispose]() {
    super[Symbol.dispose]();
  }
}

export async function createDemoMain() {
  await Promise.resolve(); //wait a tick
  return new Controller;
}

export async function openDemoService(testdata: string) {
  await Promise.resolve(); //wait a tick
  return new ClusterTestLink(null, testdata);
}

export type { ClusterTestLink };

openDemoService satisfies ServiceClientFactoryFunction;
