import { debugFlags } from "@webhare/env";
import type { RPCAPI, RPCContext, RPCFilter } from "@webhare/router";
import { beginWork } from "@webhare/whdb";

import { testschemaSchema, type OidcschemaSchemaType } from "wh:wrd/webhare_testsuite";
import { sleep, throwError } from "@webhare/std";
import { getTestSiteJS } from "./wts-backend";
import { WRDSchema } from "@webhare/wrd";
import { prepareFrontendLogin } from "@webhare/auth";

export async function filterAPI(context: RPCContext, args: unknown[]) {
  if (context.request.headers.get("filter") === "throw")
    throw new Error("Intercepted");
  if (context.method === "echo" && args[0] === -42)
    return { result: [-43] };
  if (context.method === "echo" && args[0] === -43)
    return {};
}

export interface TestApiValidateEmail {
  validateEmail(langcode: string, emailaddress: string): Promise<boolean>;
}

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
    const userId = await context.getRequestUser(testschemaSchema);
    if (userId) {
      const user = await testschemaSchema.getFields("wrdPerson", userId, ["wrdFullName"]);
      if (user)
        return { user: user.wrdFullName };
    }

    return { user: "" };
  },
  async getCustomClaimAction() {
    const oidcAuthSchema = new WRDSchema<OidcschemaSchemaType>("webhare_testsuite:testschema");
    const targetlink = (await getTestSiteJS()).webRoot + "testpages/wrdauthtest/";
    const pietje = await oidcAuthSchema.find("wrdPerson", { wrdContactEmail: "pietje-js@beta.webhare.net" }) ?? throwError("Pietje not found");

    return await prepareFrontendLogin(targetlink, pietje, {
      claims: { ["custom.impersonate"]: true }
    });
  },
  async setCookies(context: RPCContext) {
    context.responseHeaders.append("Set-Cookie", "testcookie=124");
    context.responseHeaders.append("Set-Cookie", "testcookie2=457");
    return { cookiesSet: true };
  }
};

filterAPI satisfies RPCFilter;
testAPI satisfies RPCAPI;
