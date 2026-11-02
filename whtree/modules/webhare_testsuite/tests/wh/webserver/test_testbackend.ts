import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { ensureFallbackCertficate } from "@mod-platform/js/webserver/config";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor } from "@webhare/services";
import * as test from "@webhare/test-backend";
import { beginWork, db, isWorkOpen } from "@webhare/whdb";
import { openFolder, type WHFSFolder } from "@webhare/whfs";

async function testCreateWebServerPort() {
  const servers: test.TestWebServerPort[] = [];
  let keyFolder: WHFSFolder | undefined;
  try {
    const local = await test.createWebServer();
    servers.push(local);
    test.cmp(local.portNumber, ">", 0);
    test.eq({
      portNumber: local.portNumber,
      portId: local.portId,
      connectHost: "127.0.0.1",
      protocol: "http",
      webservers: [{ id: local.webserverId!, host: "127.0.0.1", url: `http://127.0.0.1:${local.portNumber}/` }],
      webserverId: local.webserverId,
      baseURL: `http://127.0.0.1:${local.portNumber}/`
    }, local);
    test.eq(false, isWorkOpen());
    test.eqPartial({
      ip: "127.0.0.1",
      port: local.portNumber,
      virtualhost: false,
      keypair: null,
      description: "testframework.whlib created temporary test port"
    }, await db<PlatformDB>().selectFrom("system.ports").selectAll().where("id", "=", local.portId).executeTakeFirstOrThrow());
    test.eq([
      { path: "/", matchtype: 1, hostingsrc: 6, hostingpath: "webhare_testsuite:testframework" },
      { path: "/webhare_testsuite/betatestaccessrule/", matchtype: 0, hostingsrc: 0, hostingpath: "" }
    ], await db<PlatformDB>().selectFrom("system.access").select(["path", "matchtype", "hostingsrc", "hostingpath"])
      .where("webserver", "=", local.webservers[0].id).orderBy("path").execute());

    const virtual = await test.createWebServer({
      virtualHosts: ["first.beta.webhare.net", "second.beta.webhare.net"],
      aliases: ["alias.beta.webhare.net"],
      redirectingAliases: ["redirect.beta.webhare.net"],
      strictTransportSecurity: 3600
    });
    servers.push(virtual);
    test.eq(false, "webserverId" in virtual);
    test.eq(false, "baseURL" in virtual);
    test.eq([
      { id: virtual.webservers[0].id, host: "first.beta.webhare.net", url: `http://first.beta.webhare.net:${virtual.portNumber}/` },
      { id: virtual.webservers[1].id, host: "second.beta.webhare.net", url: `http://second.beta.webhare.net:${virtual.portNumber}/` }
    ], virtual.webservers);
    test.eq(true, (await db<PlatformDB>().selectFrom("system.ports").select("virtualhost").where("id", "=", virtual.portId).executeTakeFirstOrThrow()).virtualhost);
    test.eq([
      { port: null, stricttransportsecurity: 3600 },
      { port: null, stricttransportsecurity: 3600 }
    ], await db<PlatformDB>().selectFrom("system.webservers").select(["port", "stricttransportsecurity"])
      .where("id", "in", virtual.webservers.map(server => server.id)).orderBy("id").execute());
    test.eq([
      { webserver: virtual.webservers[0].id, hostname: "alias.beta.webhare.net", explicit: true },
      { webserver: virtual.webservers[0].id, hostname: "redirect.beta.webhare.net", explicit: false }
    ], await db<PlatformDB>().selectFrom("system.webservers_aliases").select(["webserver", "hostname", "explicit"])
      .where("webserver", "in", virtual.webservers.map(server => server.id)).orderBy("hostname").execute());

    const noListener = await test.createWebServer({ port: 0, outputServer: true });
    servers.push(noListener);
    test.eq(0, noListener.portId);
    test.eq(0, noListener.portNumber);
    test.eq("http://127.0.0.1/", noListener.baseURL);
    const output = await db<PlatformDB>().selectFrom("system.webservers").select(["type", "port", "diskfolder"])
      .where("id", "=", noListener.webservers[0].id).executeTakeFirstOrThrow();
    test.eqPartial({ type: 0, port: null, diskfolder: /^\/.+\/$/ }, output);

    const explicitOutput = await test.createWebServer({
      port: 0,
      outputServer: true,
      diskFolder: output.diskfolder,
      virtualHosts: ["output.beta.webhare.net"]
    });
    servers.push(explicitOutput);
    test.eq("http://output.beta.webhare.net/", explicitOutput.webservers[0].url);
    test.eq(output.diskfolder, (await db<PlatformDB>().selectFrom("system.webservers").select("diskfolder")
      .where("id", "=", explicitOutput.webservers[0].id).executeTakeFirstOrThrow()).diskfolder);

    const { certPem, keyPem } = await ensureFallbackCertficate();
    {
      await using work = await beginWork();
      const keystore = await (await openFolder("/webhare-private/system")).ensureFolder("keystore");
      keyFolder = await keystore.createFolder(await keystore.generateName("webhare_testsuite_testbackend"));
      await keyFolder.createFile("privatekey.pem", { data: await ResourceDescriptor.from(keyPem) });
      await keyFolder.createFile("certificatechain.pem", { data: await ResourceDescriptor.from(certPem) });
      await work.commit();
    }
    const secure = await test.createWebServer({ ipv6: true, secureKeyFile: keyFolder.name.toUpperCase(), virtualHost: true });
    servers.push(secure);
    test.eq("::1", secure.connectHost);
    test.eq("https", secure.protocol);
    test.eq(`https://[::1]:${secure.portNumber}/`, secure.baseURL);
    test.eqPartial({ ip: "::1", keypair: keyFolder.id, virtualhost: true },
      await db<PlatformDB>().selectFrom("system.ports").selectAll().where("id", "=", secure.portId).executeTakeFirstOrThrow());

    for (const port of [-1, 65536, 1.5, NaN])
      await test.throws(/Invalid TCP port/, test.createWebServer({ port }));
    test.eq(false, isWorkOpen());
    await test.throws(/webhare_testsuite_nonexistent/, test.createWebServer({ secureKeyFile: "webhare_testsuite_nonexistent" }));
    test.eq(false, isWorkOpen());
    {
      await using work = await beginWork();
      void (work);
      await test.throws(/Work has already been opened/, test.createWebServer());
      test.eq(true, isWorkOpen());
    }
  } finally {
    await using work = await beginWork();
    const webserverIds = servers.flatMap(server => server.webservers.map(webserver => webserver.id));
    const portIds = servers.map(server => server.portId).filter(id => id !== 0);
    if (webserverIds.length)
      await db<PlatformDB>().deleteFrom("system.webservers").where("id", "in", webserverIds).execute();
    if (portIds.length)
      await db<PlatformDB>().deleteFrom("system.ports").where("id", "in", portIds).execute();
    if (keyFolder)
      await keyFolder.delete();
    await work.commit();
    await loadlib("mod::system/lib/internal/resourcemanager.whlib").RefreshGlobalWebServerConfig();
  }
}

test.runTests([
  testCreateWebServerPort
]);
