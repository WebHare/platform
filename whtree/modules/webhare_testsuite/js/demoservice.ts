class ClusterTestLink {
  constructor(testdata: string) {
    if (testdata == "abort")
      throw new Error("abort");
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
  // TODO? do we still need this?
  // emitTestEvent(data)
  // {
  //   this.EmitEvent("testevent", data);
  // }
}

export function openDemoService(testdata: string) {
  return new ClusterTestLink(testdata);
}
