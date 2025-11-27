import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import type { Configuration } from "@mod-platform/js/webserver/webconfig";
import * as webserver from "@mod-platform/js/webserver/webserver";
import * as net from "node:net";
import * as undici from "undici";
import { loadlib } from "@webhare/harescript";

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
  //Get the fallback certificate so we have a keypair to test with
  const fallback_privatekey = await whfs.openFile("/webhare-private/system/keystore/fallback/privatekey.pem");
  const fallback_certificate = await whfs.openFile("/webhare-private/system/keystore/fallback/certificatechain.pem");

  const port_http = await getAvailableServerPort();
  const port_https = await getAvailableServerPort();
  const config = (await loadlib("mod::system/lib/internal/webserver/config.whlib").DownloadWebserverConfig()) as Configuration;
  config.ports = [
    {
      port: port_http,
      certificatechain: "",
      ciphersuite: "",
      id: -1,
      ip: "127.0.0.1",
      istrustedport: false,
      keypair: 0,
      privatekey: "",
      virtualhost: true
    },
    {
      port: port_https,
      certificatechain: await fallback_certificate.data.resource.text(),
      ciphersuite: "",
      id: -1,
      ip: "127.0.0.1",
      istrustedport: false,
      keypair: 0,
      privatekey: await fallback_privatekey.data.resource.text(),
      virtualhost: true
    }
  ];

  const ws = new webserver.WebServer("webhare_testsuite:testwebserver", { forceConfig: config });
  ws.unref();

  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const markdowndocurl = new URL(markdowndoc.link!);
  const testorigin = markdowndocurl.protocol + "//127.0.0.1:" + (markdowndocurl.protocol === "https:" ? port_https : port_http);

  //CI publishes the testsite on http, but development servers often use https with a self-signed cert
  const insecureagent = new undici.Agent({
    connect: {
      rejectUnauthorized: false
    }
  });

  const response = await (await undici.request(testorigin + markdowndocurl.pathname, {
    headers: { host: markdowndocurl.host },
    dispatcher: insecureagent
  })).body.text();
  test.eq(/<html.*>.*<h2.*>Markdown file<\/h2>/, response);

  const testsuiteresources = testorigin + "/tollium_todd.res/webhare_testsuite/tests/";
  let fetcher = await undici.request(testsuiteresources + "getrequestdata.shtml", {
    headers: { host: markdowndocurl.host, accept: "application/json" },
    dispatcher: insecureagent
  });

  test.eq(200, fetcher.statusCode);
  test.eq("application/json", fetcher.headers["content-type"]);
  let grd = await fetcher.body.json() as GetRequestDataResponse;
  test.eq("GET", grd.method);

  grd = await (await undici.request(testsuiteresources + "getrequestdata.shtml", {
    headers: {
      host: markdowndocurl.host,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "a=1&b=2",
    method: "POST",
    dispatcher: insecureagent
  })).body.json() as GetRequestDataResponse;
  test.eq("POST", grd.method);


  { //Verify redirect
    const res = await (await undici.request(testsuiteresources + "webserver.shtml?type=redirect&status=301", {
      headers: {
        host: markdowndocurl.host,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: "a=1&b=2",
      method: "POST",
      dispatcher: insecureagent
    }));

    test.eq(301, res.statusCode);
    test.eq("http://www.test.invalid/301", res.headers.location);
  }

  //Verify cookie processing
  fetcher = await undici.request(testsuiteresources + "cookies.shtml?type=setcookie3", {
    headers: { host: markdowndocurl.host, accept: "application/json" },
    dispatcher: insecureagent
  });
  const setcookie: string[] = (fetcher.headers["set-cookie"] as string)?.split?.(',') ?? [];
  test.eq(7, setcookie.length);
  test.eq("sc3-test2=val2-overwrite;Path=/;HttpOnly", setcookie[1].trim());

  //TODO without explicitly closing the servers we linger for 4 seconds if we did a request ... but not sure why. and now ws.close isn't enough either so we're missing something...
  console.log("jswebserver test done");
  ws.close();
}

test.runTests([testOurWebserver]);
