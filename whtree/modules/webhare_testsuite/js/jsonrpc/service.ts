import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { MyService } from "./type";
import { debugFlags } from "@webhare/env";
import { WebRequest } from "@webhare/router";
import { getRequestUser } from "@webhare/wrd";
import { beginWork } from "@webhare/whdb";

export class TestNoAuthJS implements MyService {
  private req: WebRequest;

  constructor(req: WebRequest) {
    this.req = req;
  }

  async lockWork() {
    await beginWork({ mutex: "webhare_testsuite:lockit" });
  }
  async validateEmail(langcode: string,
    emailaddress: string): Promise<boolean> {
    return Boolean(emailaddress.match(/webhare.dev$/));
  }
  async serverCrash() {
    throw new Error("this is a server crash");
  }
  async describeMyRequest() {
    return {
      baseURL: this.req.baseURL,
      url: this.req.url.toString(),
      requestHeaders: Object.fromEntries(this.req.headers.entries()),
      debugFlags: Object.keys(debugFlags).filter((flag) => debugFlags[flag])
    };
  }
  async doConsoleLog() {
    console.log(`This log statement was generated on the server by the TestNoAuthJS service`);
    return null;
  }
  async validateLoggedinUser(pathname: string): Promise<{ user: string }> {
    const userinfo = await getRequestUser(this.req, pathname);
    if (userinfo) {
      const user = await wrdTestschemaSchema.getFields("wrdPerson", userinfo.user, ["wrdFullName"]);
      if (user)
        return { user: user.wrdFullName };
    }

    return { user: "" };
  }
}
