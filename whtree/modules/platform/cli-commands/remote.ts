// @webhare/cli: Connect to remote WebHare servers

import { deletePeerRegistrations, getPeerServerToken, listPeers } from "@mod-platform/js/remote/connect";
import { commonFlags } from "@mod-platform/js/cli/cli-tools";
import { CLIRuntimeError, enumOption, runCli } from "@webhare/cli";
import { regExpFromWildcards } from "@webhare/std";
import { wrd, type WRDSchemaLike } from "@webhare/wrd";
import { spawnSync } from "child_process";

/** Get the user management schema to use, or undefined to let the APIs pick the primary auth schema */
function getUserSchema(opts: { schema?: string }) {
  return opts.schema ? wrd<WRDSchemaLike["system:usermgmt"]>(opts.schema) : undefined;
}

runCli({
  description: "Connect this WebHare to a remote WebHare server",
  options: {
    "s,schema": { description: "Schema to use (if not primary schema)" },
  },
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
        const peers = (await listPeers({ wrdSchema: getUserSchema(opts) })).filter(peer => matchesMask(peer.url));
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
        const userSchema = getUserSchema(opts);
        const scopes = opts.scopes?.split(/[\s,]+/).filter(scope => scope) ?? [];
        let result = await getPeerServerToken(args.url, { userSchema, prompt: opts.prompt, scopes });
        if (result.status === "interactionRequired") {
          console.log("Go to the following URL:", result.requestUrl);
          spawnSync("/usr/bin/open", [result.requestUrl], { stdio: "inherit" });
          result = await result.tokenPromise;
        }
        if (result.status === "error")
          throw new CLIRuntimeError(`Failed to obtain a token: ${result.message}`);

        const token = result.token;
        console.log(`Connected. Token with scopes ${token.scopes?.join(" ") ?? ""} expires at ${token.expires?.toISOString() ?? ""}`);
      }
    },
    delete: {
      description: "Delete this server's registration with a remote WebHare",
      arguments: [{ name: "<url>", description: "Remote WebHare base URL" }],
      async main({ args, opts }) {
        const deleted = await deletePeerRegistrations(args.url, { wrdSchema: getUserSchema(opts) });
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
