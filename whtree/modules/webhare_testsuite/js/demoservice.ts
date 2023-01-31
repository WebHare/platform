import { ConvertBackendServiceInterfaceToClientInterface, BackendServiceContext } from "@webhare/services";

interface MainObjectInterface {
  dummy: number;
}

class ClusterTestLink {
  dummy = 42;
  mainobject: MainObjectInterface;
  // null-likes completely broke interface description earlier, so test them specifically
  aNull = null;
  anUndefined = undefined;

  constructor(maininstance: MainObjectInterface, testdata: string) {
    if (testdata == "abort")
      throw new Error("abort");

    this.mainobject = maininstance;
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
    return this.mainobject.dummy;
  }
  setShared(val: number) {
    this.mainobject.dummy = val;
    return null; //FIXME marshalling cannot deal with service APIs returning undefined
  }
  // TODO? do we still need this?
  // emitTestEvent(data)
  // {
  //   this.EmitEvent("testevent", data);
  // }
}

export type DemoServiceInterface = ConvertBackendServiceInterfaceToClientInterface<ClusterTestLink>;

export async function createDemoMain(): Promise<MainObjectInterface> {
  await Promise.resolve(); //wait a tick
  return { dummy: 42 };
}

export async function openDemoService(context: BackendServiceContext, testdata: string) {
  await Promise.resolve(); //wait a tick
  return new ClusterTestLink(context.mainobject as MainObjectInterface, testdata);
}
