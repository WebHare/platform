import { runInWork } from "@webhare/whdb";
import { wrd } from "@webhare/wrd";

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
  if (!forgesettings?.token) {
    console.error(`Set up an API token for forge ${apiRoot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
    process.exit(1);
  }
  return { user, apiRoot, token: forgesettings.token, project };
}
