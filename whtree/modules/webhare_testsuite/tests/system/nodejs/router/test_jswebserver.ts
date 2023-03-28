import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import * as services from "@webhare/services";
import { Configuration } from "@mod-system/js/internal/webserver/webconfig";
import * as webserver from "@mod-system/js/internal/webserver/webserver";
import * as net from "node:net";

//https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
interface HeadersWithSetSookie extends Headers {
  getSetCookie(): string[];
}

interface GetRequestDataResponse {
  method: string;
  webvars: Array<{ ispost: boolean; name: string; value: string }>;
}

async function getAvailableServerPort() {
  //have the OS select a free port
  const server = net.createServer({});
  const listenwaiter = new Promise(resolve => server.once("listening", resolve));
  server.listen({ port: 0, host: "127.0.0.1" });
  await listenwaiter;

  const port = (server.address() as net.AddressInfo).port;
  await new Promise(resolve => server.close(resolve));
  if (!port)
    throw new Error(`Failed to find an available port`);
  return port;
}


async function testOurWebserver() {
  await services.ready();

  const port = await getAvailableServerPort();
  const config = (await services.callHareScript("mod::system/lib/internal/webserver/config.whlib#DownloadWebserverConfig", [], { openPrimary: true })) as Configuration;
  config.ports = [
    {
      port: port,
      certificatechain: "",
      ciphersuite: "",
      id: -1,
      ip: "127.0.0.1",
      istrustedport: true,
      keypair: 0,
      privatekey: "",
      virtualhost: true
    }
  ];

  const ws = await webserver.launch(config);
  ws.unref();

  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const markdowndocurl = new URL(markdowndoc.link);

  const response = await (await fetch("http://127.0.0.1:" + port + markdowndocurl.pathname, { headers: { host: markdowndocurl.host } })).text();
  test.eqMatch(/<html.*>.*<h2.*>Markdown file<\/h2>/, response);

  const testsuiteresources = "http://127.0.0.1:" + port + "/tollium_todd.res/webhare_testsuite/tests/";
  let fetcher = await fetch(testsuiteresources + "getrequestdata.shtml", { headers: { host: markdowndocurl.host, accept: "application/json" } });
  test.eq(200, fetcher.status);
  test.eq("application/json", fetcher.headers.get("content-type"));
  let grd = await fetcher.json() as GetRequestDataResponse;
  test.eq("GET", grd.method);

  grd = await (await fetch(testsuiteresources + "getrequestdata.shtml", {
    headers: {
      host: markdowndocurl.host,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "a=1&b=2",
    method: "POST"
  })).json() as GetRequestDataResponse;
  test.eq("POST", grd.method);

  //Verify cookie processing
  fetcher = await fetch(testsuiteresources + "cookies.shtml?type=setcookie3", { headers: { host: markdowndocurl.host, accept: "application/json" } });
  test.eq(7, (fetcher.headers as HeadersWithSetSookie).getSetCookie().length);
  test.eq("sc3-test2=val2-overwrite;Path=/;HttpOnly", (fetcher.headers as HeadersWithSetSookie).getSetCookie()[1]);

  //without explicitly closing the servers we linger for 4 seconds if we did a request ... but not sure why.
  ws.close();
}


test.run([testOurWebserver]);
