import { getJSONAPICallWebRequest } from "@mod-system/js/internal/jsonrpccaller";
import { MyService } from "./type";
import { debugFlags } from "@webhare/env/src/envbackend";

export class TestNoAuthJS implements MyService {
  async validateEmail(langcode: string,
    emailaddress: string): Promise<boolean> {
    return Boolean(emailaddress.match(/webhare.dev$/));
  }
  async serverCrash() {
    throw new Error("this is a server crash");
  }
  async describeMyRequest() {
    const info = getJSONAPICallWebRequest();
    return {
      baseURL: info.baseURL,
      url: info.url.toString(),
      requestHeaders: Object.fromEntries(info.headers.entries()),
      debugFlags: Object.keys(debugFlags).filter((flag) => debugFlags[flag])
    };
  }
  async doConsoleLog() {
    console.log(`This log statement was generated on the server by the TestNoAuthJS service`);
    return null;
  }
}
