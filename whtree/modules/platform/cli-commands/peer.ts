// @webhare/cli: Connect to remote WebHare servers

import { deletePeerRegistrations, getPeerServerToken, listPeers, getPeerServerTokenURL } from "@mod-platform/js/remote/connect";
import { commonFlags } from "@mod-platform/js/cli/cli-tools";
import { enumOption, runCli } from "@webhare/cli";
import { attempt, regExpFromWildcards } from "@webhare/std";
import { spawnSync } from "child_process";

runCli({
  description: "Connect this WebHare to a remote WebHare server",
  subCommands: {
    list: {
      description: "List remote WebHares this server is registered with or has a token for",
      flags: {
        ...commonFlags.json
      },
      arguments: [{ name: "[mask]", description: "Only list peers whose URL or origin matches this mask (case insensitive, supports * and ? wildcards, eg '*.webhare.dev' or '*accept*')" }],
      async main({ opts, args }) {
        const mask = args.mask ? regExpFromWildcards(args.mask, { caseInsensitive: true }) : null;
        //Matching the origin too allows masks without the trailing slash or path of the stored URL
        const matchesMask = (url: string) => !mask || mask.test(url) || (URL.canParse(url) && mask.test(new URL(url).origin));
        const peers = (await listPeers()).filter(peer => matchesMask(peer.url));
        if (opts.json)
          console.log(JSON.stringify(peers, null, 2));
        else if (!peers.length)
          console.log("No peers");
        else
          console.table(peers.map(peer => ({
            url: peer.url,
            title: peer.title,
            registered: peer.authServer !== null,
            tokenExpires: peer.tokenExpires?.toISOString() ?? "",
            expired: peer.tokenExpires ? peer.tokenExpires.getTime() < Date.now() : "",
            scopes: peer.scopes?.join(" ") ?? "",
            lastUse: peer.lastUse?.toString() ?? ""
          })));
      }
    },
    connect: {
      description: "Register this server with a remote WebHare",
      arguments: [{ name: "<url>", description: "Remote WebHare base URL" }],
      options: {
        prompt: {
          type: enumOption(["login", "none", "consent", "select_account"]),
          description: "Always request a new token, passing this OAuth2 prompt to the remote (eg 'login' to force logging in again)"
        },
        scopes: {
          description: "Comma or space separated scopes to request (default: platform:sysop). Requests a new token if the current one lacks any of them"
        }
      },
      async main({ args, opts }) {
        const scopes = opts.scopes?.split(/[\s,]+/).filter(scope => scope) ?? [];
        const currentToken = opts.prompt ? null : await attempt(getPeerServerToken(args.url), null);
        let token = currentToken && scopes.every(scope => currentToken.scopes.includes(scope)) ? currentToken : null;
        if (!token) {
          const gettoken = await getPeerServerTokenURL(args.url, { prompt: opts.prompt, scopes });
          console.log("Go to the following URL:", gettoken.requesturl);
          spawnSync("/usr/bin/open", [gettoken.requesturl], { stdio: "inherit" });
          token = await gettoken.tokenpromise;
        }
        console.log(`Connected. Token with scopes ${token.scopes?.join(" ") ?? ""} expires at ${token.expires?.toISOString() ?? ""}`);
      }
    },
    delete: {
      description: "Delete this server's registration with a remote WebHare",
      arguments: [{ name: "<url>", description: "Remote WebHare base URL" }],
      async main({ args }) {
        const deleted = await deletePeerRegistrations(args.url);
        if (!deleted.authServers.length && !deleted.peerServers) {
          console.error(`No peer registration or token found for ${args.url}`);
          return 1;
        }
        for (const server of deleted.authServers) {
          console.log(`Deleted ${server.wrdTitle} (authentication server #${server.wrdId})`);
          if (server.remoteError)
            console.error(`  Could not remove the registration at the remote server: ${server.remoteError}`);
        }
        if (deleted.peerServers)
          console.log(`Deleted ${deleted.peerServers} stored token(s) for ${args.url}`);
      }
    }
  }
});
