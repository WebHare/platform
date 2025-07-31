import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_webserver_hstrustedportoffset, whconstant_webserver_indexpages, whconstant_webserver_trustedportoffset, whconstant_webservertype_interface, whwebserverconfig_hstrustedportid, whwebserverconfig_rescueportid, whwebserverconfig_rescueportoffset, whwebserverconfig_rescuewebserverid, whwebserverconfig_trustedportid } from "@mod-system/js/internal/webhareconstants";
import { getBasePort } from "@webhare/services/src/config";
import { appendToArray, regExpFromWildcards } from "@webhare/std";
import { db } from "@webhare/whdb";

type WebServer = {
  id: number;
  defaultpages: string[];
  is_interface_webserver: boolean;
  baseurl: string;
  port: number;
  lowercasemode: boolean;
  forcehttps: boolean;
  forcehttpsport: number;
  type: number;
  diskfolder: string;
  stricttransportsecurity: number;
};

function isDefaultPort(url: URL) {
  return getActualPort(url) === (url.protocol === "https:" ? 443 : 80);
}
function getDefaultPort(url: URL): number {
  if (url.protocol === "https:")
    return 443;
  if (url.protocol === "http:")
    return 80;
  throw new Error(`Unknown protocol ${url.protocol} for URL ${url.href}`);
}

export function getActualPort(url: URL): number {
  return url.port ? parseInt(url.port, 10) : getDefaultPort(url); parseInt(url.port, 10);
}

export async function enumerateAllWebServers(minimalConfig: boolean): Promise<WebServer[]> {
  const rescueport = getBasePort();
  const hosts = [];
  hosts.push({
    id: whwebserverconfig_rescuewebserverid,
    defaultpages: whconstant_webserver_indexpages,
    is_interface_webserver: true,
    baseurl: `http://127.0.0.1:${rescueport}/`,
    port: whwebserverconfig_rescueportid,
    lowercasemode: true,
    forcehttps: false,
    forcehttpsport: 0,
    type: whconstant_webservertype_interface,
    diskfolder: "",
    stricttransportsecurity: 0
  });
  if (!minimalConfig) {
    const servers = await db<PlatformDB>().selectFrom("system.webservers")
      .selectAll()
      .where("type", "in", [0, whconstant_webservertype_interface])
      .execute();
    appendToArray(hosts, servers.map(server => {
      const unpackedbaseurl = new URL(server.baseurl);
      const forcehttps = server.port === null && server.baseurl.startsWith("https:");
      return {
        id: server.id,
        defaultpages: whconstant_webserver_indexpages,
        is_interface_webserver: server.type === whconstant_webservertype_interface,
        baseurl: server.baseurl,
        port: server.port || 0, //remapping null to 0 for HS compatibility
        lowercasemode: true,
        forcehttps: forcehttps,
        forcehttpsport: forcehttps ? getActualPort(unpackedbaseurl) : 0,
        type: server.type,
        diskfolder: server.diskfolder,
        stricttransportsecurity: server.stricttransportsecurity
      };
    }));
  }
  return hosts;
}

function getGlobalOrdering(hostname: string): number {
  if (!hostname.includes("*") && !hostname.includes("?")) //plain hostname
    return -1;
  if (hostname === "*")
    return 2;
  return hostname !== "" && hostname.endsWith('*') ? 0 : 1;
}


async function enrichWithListenHosts<H extends { baseurl: string; port: number; id: number }>(inhosts: H[], minimalConfig: boolean): Promise<Array<H & { hostname: string; listenhosts: string[] }>> {
  const hosts = new Array<H & { hostname: string; listenhosts: string[] }>;
  const aliaslist: Array<{ webserver: number; hostname: string }> = [];
  if (!minimalConfig) {
    appendToArray(aliaslist, await db<PlatformDB>().selectFrom("system.webservers_aliases")
      .select(["webserver", "hostname"])
      .where("explicit", "=", true)
      .execute());
  }
  for (const host of inhosts) {
    const unp = new URL(host.baseurl);
    const hostname = unp.hostname.includes("::") ? `[${unp.hostname.toUpperCase()}]` : unp.hostname.toUpperCase(); // wrap IPv6 addresses
    const listenhosts: string[] = [];
    if (host.port === 0) {
      listenhosts.push(hostname);
      for (const alias of aliaslist) {
        if (alias.webserver === host.id) {
          listenhosts.push(alias.hostname.toUpperCase());
        }
      }
    } else {
      listenhosts.push(`${hostname}${isDefaultPort(unp) ? "" : `:${unp.port}`}`);
      if (!isDefaultPort(unp))
        listenhosts.push(`*:${unp.port}`);
    }

    hosts.push({
      ...host,
      hostname: hostname.toLowerCase(),
      listenhosts: listenhosts
    });
  }
  for (const host of hosts) {
    host.listenhosts!.sort((lhs, rhs) => {
      const lhs_globalordering = getGlobalOrdering(lhs);
      const rhs_globalordering = getGlobalOrdering(rhs);
      if (lhs_globalordering !== rhs_globalordering) {
        return lhs_globalordering - rhs_globalordering;
      }
      if (lhs.length !== rhs.length)
        return lhs.length - rhs.length; // prefer shorter hostnames

      return lhs.toUpperCase() < (rhs.toUpperCase()) ? -1 : 1;
    });
  }
  return hosts;
}

export async function getHostedSites() {
  const webservers = await enumerateAllWebServers(false);
  const hosts = webservers.map(server => ({
    id: server.id,
    baseurl: server.baseurl,
    port: server.port,
    isinterface: server.is_interface_webserver
  }));
  const ports = await db<PlatformDB>().selectFrom("system.ports")
    .select(["id", "virtualhost", "port"])
    .execute();

  // Also mark our trusted port as a virtualhosted port
  ports.push({
    id: whwebserverconfig_trustedportid,
    virtualhost: true,
    port: getBasePort() + whconstant_webserver_trustedportoffset
  }, {
    id: whwebserverconfig_hstrustedportid,
    virtualhost: true,
    port: getBasePort() + whconstant_webserver_hstrustedportoffset
  }, { //and add the "rescue" port which simply hosts the WebHare backend
    id: whwebserverconfig_rescueportid,
    virtualhost: false,
    port: getBasePort() + whwebserverconfig_rescueportoffset
  });

  //FIXME ttl 15 * 60 * 1000, eventmasks ["system:internal.webserver.didconfigreload"]
  return { hosts: await enrichWithListenHosts(hosts, false), ports };
}

export async function lookupWebserver(findhostname: string, findport: number) {
  const hostinginfo = await getHostedSites();

  //enumerate all our ports.. bit of a workaround as we may not know whether the host is IPv4 or IPv6
  findhostname = findhostname.toUpperCase();
  const ports = await hostinginfo.ports.filter(port => port.port === findport);

  if (ports.some(port => port.virtualhost) || (ports.length === 0 && [80, 443].includes(findport))) {
    const byhost = hostinginfo.hosts.find(server => server.listenhosts!.includes(findhostname));
    if (byhost)
      return byhost;

    const bywildcard = hostinginfo.hosts.find(server => regExpFromWildcards(server.listenhosts).test(findhostname));
    if (bywildcard)
      return bywildcard;
  }
  for (const port of ports) {
    if (port.virtualhost)
      continue; // skip virtualhosted ports

    const matchserver = hostinginfo.hosts.find(server => server.port === port.id);
    if (matchserver)
      return matchserver;
  }
  return null;
}
