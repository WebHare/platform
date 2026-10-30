import { createTrustedPortDispatcher, fetch } from "@webhare/test-backend";
import { backendConfig } from "@webhare/services";
import * as test from "@webhare/test";
import { isIP } from "node:net";

interface GetRequestDataResponse {
  localport: number;
  localip: string;
  remoteport: number;
  remoteip: string;
  clienturl: string;
  serverurl: string;
  method: string;
}

async function testRemoteIP() {
  const url = new URL("tollium_todd.res/webhare_testsuite/tests/getrequestdata.shtml", backendConfig.backendURL);
  const response = await fetch(url, { headers: { accept: "application/json" } });

  test.eq(200, response.status);
  test.eq("application/json", response.headers.get("content-type"));

  const grd = await response.json() as GetRequestDataResponse;
  test.eq("GET", grd.method);
  test.eq(url.href, grd.clienturl);

  //the IP we're connecting from - depends on the interface used to reach the backend, so we can only verify it's a valid IP
  test.assert(isIP(grd.remoteip) !== 0, `remoteip '${grd.remoteip}' is not a valid IP address`);
  test.assert(isIP(grd.localip) !== 0, `localip '${grd.localip}' is not a valid IP address`);
  test.eq(parseInt(url.port || (url.protocol === "https:" ? "443" : "80")), grd.localport);
}

async function testTrustedPort() {
  const url = new URL("tollium_todd.res/webhare_testsuite/tests/getrequestdata.shtml", backendConfig.backendURL);
  const dispatcher = createTrustedPortDispatcher({ sourceIP: "10.11.12.13" });

  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, dispatcher });
    test.eq(200, response.status);

    const grd = await response.json() as GetRequestDataResponse;
    test.eq("GET", grd.method);
    //the trusted port should rewrite the request to look like it came in on the original url from our mocked source IP
    test.eq(url.href, grd.clienturl);
    test.eq("10.11.12.13", grd.remoteip);
  } finally {
    await dispatcher.close();
  }
}

test.runTests([testRemoteIP, testTrustedPort]);
