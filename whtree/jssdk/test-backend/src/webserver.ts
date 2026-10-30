//TODO: A lot of this should become a more official webserver mgmt api

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { defaultDateTime } from "@webhare/hscompat";
import { generateRandomId } from "@webhare/std";
import { beginWork, db } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";

export interface CreateWebServerPortOptions {
  /** TCP port to bind. Defaults to an available port; 0 only creates webservers, without a listener. */
  port?: number;
  /** Hostnames to serve through virtual hosting. */
  virtualHosts?: string[];
  /** Non-redirecting aliases for the first webserver. */
  aliases?: string[];
  /** Redirecting aliases for the first webserver. */
  redirectingAliases?: string[];
  /** Enable virtual hosting even when no virtualHosts are specified. */
  virtualHost?: boolean;
  /** Set a hostname for non virtual hosts */
  hostname?: string;
  /** Bind to ::1 instead of 127.0.0.1. */
  ipv6?: boolean;
  /** Name of a keypair in the WebHare keystore to use for HTTPS. */
  secureKeyFile?: string;
  /** Create output webservers instead of backend interface webservers. */
  outputServer?: boolean;
  /** Output directory, ending in /. Defaults to a temporary pathname for output webservers. */
  diskFolder?: string;
  /** HSTS max-age in seconds. */
  strictTransportSecurity?: number;
}

export interface TestWebServerPort {
  portNumber: number;
  /** Database port ID, or 0 when no listener was created. */
  portId: number;
  webservers: Array<{ id: number; host: string; url: string }>;
  connectHost: string;
  protocol: "http" | "https";
  /** Only present when virtualHosts is empty. */
  webserverId?: number;
  /** Only present when virtualHosts is empty. */
  baseURL?: string;
}

async function getAvailablePort(host: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Failed to find an available TCP port");
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

/** Create temporary test webservers, reload the webserver configuration and verify the listener.
 * Must be called outside an open transaction. The test framework recognizes these records for cleanup.
 */
export async function createWebServer(options: CreateWebServerPortOptions = {}): Promise<TestWebServerPort> {
  const virtualHosts = options.virtualHosts ?? [];
  const isVirtualHost = virtualHosts.length > 0 || options.virtualHost === true;
  if (isVirtualHost && options.hostname)
    throw new Error("Cannot set hostname for virtual hosted webservers");

  const connectHost = options.ipv6 ? "::1" : "127.0.0.1";
  const httpHost = options.hostname || (options.ipv6 ? "[::1]" : connectHost);
  const protocol = options.secureKeyFile ? "https" : "http";
  const webservers: TestWebServerPort["webservers"] = [];

  await using work = await beginWork();
  //TODO weird default: if you don't specify a port we'll create one, even for virtual hosted webservers. a non-test API shouldn't default to that
  const portNumber = options.port ?? await getAvailablePort(connectHost);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535)
    throw new Error(`Invalid TCP port: ${portNumber}`);

  let keypair: number | null = null;
  if (portNumber && options.secureKeyFile) {
    const keystore = await openFolder("/webhare-private/system/keystore");
    keypair = (await keystore.openFolder(options.secureKeyFile)).id;
  }

  const portId = portNumber ? (await db<PlatformDB>().insertInto("system.ports").values({
    ip: connectHost,
    port: portNumber,
    keypair,
    virtualhost: isVirtualHost,
    description: "testframework.whlib created temporary test port"
  }).returning("id").executeTakeFirstOrThrow()).id : 0;

  const diskFolder = options.diskFolder || (options.outputServer ? join(tmpdir(), generateRandomId()) + "/" : "");
  for (const host of virtualHosts.length ? virtualHosts : [httpHost]) {
    const url = `${protocol}://${host}${[0, 80, 443].includes(portNumber) ? "" : `:${portNumber}`}/`;
    const { id } = await db<PlatformDB>().insertInto("system.webservers").values({
      type: options.outputServer ? 0 : 1,
      baseurl: url,
      port: virtualHosts.length ? null : portId || null,
      diskfolder: diskFolder,
      stricttransportsecurity: options.strictTransportSecurity ?? 0,
      title: "",
      lastseen: defaultDateTime,
      lastcheck: defaultDateTime,
      lastcheckerror: ""
    }).returning("id").executeTakeFirstOrThrow();

    const accessDefaults = {
      webserver: id,
      authlist: false,
      authscript: "",
      authtype: 0,
      authrequirement: false,
      description: "",
      disabled: false,
      disablecaching: false,
      errorpath: "",
      hostingpath: "",
      hostingsrc: 0,
      matchtype: 0,
      maxage: 0,
      redirectcode: 0,
      fixcase: false
    };
    await db<PlatformDB>().insertInto("system.access").values([
      { ...accessDefaults, path: "/", matchtype: 1, hostingsrc: 6, hostingpath: "webhare_testsuite:testframework" },
      { ...accessDefaults, path: "/webhare_testsuite/betatestaccessrule/", description: "A temporary accessrule to help the betatests clean up" }
    ]).execute();

    if (!webservers.length) {
      const aliasDefaults = { webserver: id, lastseen: defaultDateTime, lastcheck: defaultDateTime, lastcheckerror: "" };
      const aliases = [
        ...(options.aliases ?? []).map(hostname => ({ ...aliasDefaults, hostname, explicit: true })),
        ...(options.redirectingAliases ?? []).map(hostname => ({ ...aliasDefaults, hostname, explicit: false }))
      ];
      if (aliases.length)
        await db<PlatformDB>().insertInto("system.webservers_aliases").values(aliases).execute();
    }
    webservers.push({ id, host, url });
  }
  await work.commit();

  await loadlib("mod::system/lib/internal/resourcemanager.whlib").RefreshGlobalWebServerConfig();

  if (portNumber) {
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    try {
      const requestOptions: RequestInit & { dispatcher: Agent } = {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(10000)
      };
      const response = await fetch(`${protocol}://${httpHost}:${portNumber}/`, requestOptions);
      await response.body?.cancel();
    } catch (error) {
      throw new Error(`Failed to actually connect to test interface at ${connectHost} port ${portNumber}`, { cause: error });
    } finally {
      await dispatcher.close();
    }
  }

  return {
    portNumber,
    portId,
    webservers,
    connectHost,
    protocol,
    ...virtualHosts.length ? {} : { webserverId: webservers[0].id, baseURL: webservers[0].url }
  };
}
