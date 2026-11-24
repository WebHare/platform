import { runInWork } from "@webhare/whdb";
import { wrd } from "@webhare/wrd";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isGitHubForge } from "./github";

export const devsupportSchema = wrd("devkit:devsupport");

export function getAPIForRepo(repo: string) {
  const git_repo = repo.match(/^(ssh:\/\/)?git@([^:/]+)[:/]([^.]+)(\.git)?$/);
  if (git_repo?.[2] && git_repo?.[3])
    return { apiRoot: `https://${git_repo[2]}`, project: git_repo[3] };
  return null;
}

export async function getAutomergeConfig(forrepo: string) {
  const user = process.env.USER;
  if (!user || ["root", "git", "webhare"].includes(user)) {
    console.error(`Could not determine user name`);
    process.exit(1);
  }

  /** Repo urls may look like
   *  git@gitlab.webhare.com:group/project.git
   *  or git@gitlab.webhare.com:group/project
   *  or ssh://git@gitlab.webhare.com:group/project.git
   */
  const { apiRoot, project } = getAPIForRepo(forrepo) || {};
  if (!apiRoot || !project) {
    console.error(`Cannot figure out API root for git url: ${forrepo}`);
    process.exit(1);
  }

  //Look up this forge
  let forgeid = await devsupportSchema.search("forge", "url", apiRoot);
  if (!forgeid) {
    console.log(`No forge found for ${apiRoot} - creating`);
    forgeid = await runInWork(() => devsupportSchema.insert("forge", ({ url: apiRoot })));
  }

  const forgesettings = await devsupportSchema.getFields("forge", forgeid, ["token"]);
  if (forgesettings?.token)
    return { user, apiRoot, token: forgesettings.token, tokenSource: "forge" as const, project };

  //Without a token of our own, use the GitHub CLI's login. It covers all organizations you have access to
  if (isGitHubForge(apiRoot)) {
    const token = await getGitHubCLIToken();
    if (token)
      return { user, apiRoot, token, tokenSource: "gh" as const, project };
    console.error(`Log in with the GitHub CLI (gh auth login) or set up an API token for forge ${apiRoot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
    process.exit(1);
  }

  console.error(`Set up an API token for forge ${apiRoot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
  process.exit(1);
}

/** Get the token of the GitHub CLI's login for github.com, or null if gh isn't installed or not logged in */
async function getGitHubCLIToken(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token", "--hostname", "github.com"], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
