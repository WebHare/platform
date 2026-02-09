/* wts-backend extends @webhare/test-backend with resources that only exist in webhare_testsuite, eg the webhare_testsuite.testsite* sites */
import { WebServer } from "@mod-platform/js/webserver/webserver";
import { whconstant_whfsid_webhare_tests } from "@mod-system/js/internal/webhareconstants";
import { generateRandomId } from "@webhare/std";
import type { Configuration } from "@mod-platform/js/webserver/webconfig";
import * as test from "@webhare/test-backend";
import * as net from "node:net";
export * from "@webhare/test-backend";
import { loadlib } from "@webhare/harescript";

import { beginWork, commitWork } from "@webhare/whdb";
import { openFile, openFileOrFolder, openFolder, openSite } from "@webhare/whfs";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteHSTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}
export async function getTestSiteJSTemp() {
  return await openFolder("site::webhare_testsuite.testsitejs/tmp");
}

export async function getTestSiteHS() {
  return await openSite("webhare_testsuite.testsite");
}
export async function getTestSiteJS() {
  return await openSite("webhare_testsuite.testsitejs");
}

export async function getWHFSTestRoot() {
  return await openFolder("/webhare-tests/webhare_testsuite.testfolder");
}

export async function resetWTS(options?: test.ResetOptions) {
  await test.reset(options);

  await beginWork();

  for (const tmpfoldername of ["site::webhare_testsuite.testsite/tmp", "site::webhare_testsuite.testsitejs/tmp"]) {
    const tmpfolder = await openFolder(tmpfoldername, { allowMissing: true });
    if (tmpfolder) {
      for (const item of await tmpfolder.list()) {
        //FIXME openObjects would still be very useful
        const obj = await openFileOrFolder(item.id);
        await obj.recycle();
      }
    }
  }

  const testroot = await openFolder(whconstant_whfsid_webhare_tests);
  for (const item of await (await openFolder(whconstant_whfsid_webhare_tests)).list(["parentSite", "modified"])) {
    if (!["webhare_testsuite.testfolder", "webhare_testsuite.testfolder2"].includes(item.name) || !item.isFolder)
      continue; //only clean our own testfolders and only if they turned into a site

    const obj = await openFolder(item.id);
    if (!(await obj.list()).length && !item.parentSite)
      continue; //empty folder

    await obj.recycle();
    await testroot.createFolder(item.name);
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await getTestSiteJS();
  test.assert(testsitejs, "We need the JS testsite to exist");

  let updateres;
  if (JSON.stringify(await testsitejs.getWebFeatures()) !== JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() !== "webhare_testsuite:basetestjs") {
    updateres = await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await commitWork();
  if (updateres)
    await updateres.applied();
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


export async function createTestWebserverConfig() {
  //Get the fallback certificate so we have a keypair to test with
  const fallback_privatekey = await openFile("/webhare-private/system/keystore/fallback/privatekey.pem");
  const fallback_certificate = await openFile("/webhare-private/system/keystore/fallback/certificatechain.pem");

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
      istrustedport: true,
      keypair: 0,
      privatekey: "",
      virtualhost: true
    },
    {
      port: port_https,
      certificatechain: await fallback_certificate.data.resource.text(),
      ciphersuite: "",
      id: -2,
      ip: "127.0.0.1",
      istrustedport: true,
      keypair: 0,
      privatekey: await fallback_privatekey.data.resource.text(),
      virtualhost: true
    }
  ];

  return { config, port_http, port_https };
}

export async function getTestWebserver(url: string) {
  const { config } = await createTestWebserverConfig();
  const server = new WebServer("webhare_testsuite:basicrouter_" + generateRandomId().toLowerCase(), { forceConfig: config }); //TODO  et bind: false flags on the cnofig
  server.unref(); //prevent Active resources from keeping us alive after the test finishes
  await server.loadConfig();
  const isSecureBackend = url.startsWith("https://");
  const port = [...server.ports].find(_ => _.port.virtualhost && !isSecureBackend === !_.port.keypair);
  test.assert(port);

  return {
    server,
    clientIp: "127.0.0.1",
    port,
    localAddress: "127.0.0.1:32768"
  };
}
