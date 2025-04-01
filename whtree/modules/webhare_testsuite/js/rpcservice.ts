import { debugFlags } from "@webhare/env";
import type { RPCContext } from "@webhare/router";
import { beginWork } from "@webhare/whdb";

import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { sleep } from "@webhare/std";

export const testAPI = {
  async lockWork() {
    await beginWork({ mutex: "webhare_testsuite:lockit" });
  },
  async validateEmail(context: RPCContext, langcode: string, emailaddress: string): Promise<boolean> {
    return Boolean(emailaddress.match(/webhare.dev$/));
  },
  echo(context: RPCContext, ...args: unknown[]): unknown[] {
    return args;
  },
  iReturnNothing(): void {
  },
  serverCrash(): void { //TODO can we drop the explicit :void? it breaks the client interface generation (failing the TS asserts in test_rpc)
    throw new Error("this is a server crash");
  },
  async echoSlow(context: RPCContext, ...args: unknown[]): Promise<unknown[]> {
    await sleep(300);
    return args;
  },
  async describeMyRequest(context: RPCContext) {
    return {
      url: context.request.url.toString(),
      requestHeaders: Object.fromEntries(context.request.headers.entries()),
      debugFlags: Object.keys(debugFlags).filter((flag) => debugFlags[flag]),
      originURL: context.getOriginURL()
    };
  },
  async doConsoleLog(context: RPCContext) {
    console.log(`This log statement was generated on the server by the TestNoAuthJS service`);
    return null;
  },
  async validateLoggedinUser(context: RPCContext): Promise<{ user: string }> {
    const userId = await context.getRequestUser();
    if (userId) {
      const user = await wrdTestschemaSchema.getFields("wrdPerson", userId, ["wrdFullName"]);
      if (user)
        return { user: user.wrdFullName };
    }

    return { user: "" };
  },
  async setCookies(context: RPCContext) {
    context.responseHeaders.append("Set-Cookie", "testcookie=124");
    context.responseHeaders.append("Set-Cookie", "testcookie2=457");
    return { cookiesSet: true };
  }
};
