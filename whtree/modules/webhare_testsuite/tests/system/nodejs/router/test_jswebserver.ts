import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whfs from "@webhare/whfs";
import * as webserver from "@mod-platform/js/webserver/webserver";
import * as undici from "undici";

interface GetRequestDataResponse {
  method: string;
  webvars: Array<{ ispost: boolean; name: string; value: string }>;
}

async function testOurWebserver() {
  const { config, port_http, port_https } = await test.createTestWebserverConfig();
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
  test.eq(7, fetcher.headers["set-cookie"]?.length);
  test.eq("sc3-test2=val2-overwrite;Path=/;HttpOnly", fetcher.headers["set-cookie"]?.[1]);

  //TODO without explicitly closing the servers we linger for 4 seconds if we did a request ... but not sure why. and now ws.close isn't enough either so we're missing something...
  console.log("jswebserver test done");
  ws.close();
}

test.runTests([testOurWebserver]);
