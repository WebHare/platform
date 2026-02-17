import { devsupportSchema } from "wh:wrd/devkit";
import { executeGitCommand, executeGitCommandForeground, getRepoInfo } from '@mod-devkit/lib/internal/deploy/git';
import process from 'node:process';
import { Gitlab, type MergeRequestSchema, type PipelineSchema } from '@gitbeaker/rest';
import { GitbeakerRequestError } from '@gitbeaker/requester-utils';
import { pick, sleep } from '@webhare/std';
import { logDebug } from '@webhare/services';
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";
import { run } from "@webhare/cli";
import { simpleGit } from 'simple-git';
import { existsSync } from "node:fs";
import { join } from "node:path";

function shortLogMessage(text: string) {
  text = text.split('\n')[0];
  if (text.length > 50)
    text = text.substr(0, 50) + '…';
  return text;
}

async function handleError<T, X>(req: Promise<T>, errorMap: Record<number, X>): Promise<T | X> {
  try {
    return await req;
  } catch (e) {
    if (e instanceof GitbeakerRequestError) {
      const cause = e.cause as {
        description: string;
        request: Request;
        response: Response;
      };
      if (cause?.response?.status in errorMap)
        return errorMap[cause.response.status];
    }
    throw e;
  }
}

async function getAutomergeConfig(forrepo: string) {
  const user = process.env.USER;
  if (!user || ["root", "git", "webhare"].includes(user)) {
    console.error(`Could not determine user name`);
    process.exit(1);
  }

  let apiroot = '', project = '';
  const git_repo = forrepo.match(/^git@([^:]*):(.*)\.git$/)
    || forrepo.match(/^git@([^:]*):(.*)$/); //URLs may or may not end in .git, at least on GitLab
  if (git_repo) {
    apiroot = `https://${git_repo[1]}`;
    project = git_repo[2];
  } else {
    console.error(`Cannot figure out API root for git url: ${forrepo}`);
    process.exit(1);
  }

  //Look up this forge
  let forgeid = await devsupportSchema.search("forge", "url", apiroot);
  if (!forgeid) {
    console.log(`No forge found for ${apiroot} - creating`);
    await beginWork();
    forgeid = await devsupportSchema.insert("forge", ({ url: apiroot }));
    await commitWork();
  }

  const forgesettings = await devsupportSchema.getFields("forge", forgeid, ["token"]);
  if (!forgesettings?.token) {
    console.error(`Set up an API token for forge ${apiroot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
    process.exit(1);
  }
  return { user, apiroot, token: forgesettings.token, project };
}

run({
  flags: {
    "v,verbose": "Verbose output",
    "no-rebase": "Do not rebase the current branch before merging"
  },
  async main({ opts }) {
    const verbose: boolean = opts.verbose;
    let root = process.cwd();
    while (root !== "/" && !existsSync(join(root, "/.git")))
      root = join(root, "..");
    if (root === '/') {
      console.error("Could not find the root of the current git repository, if any");
      process.exit(1);
    }

    let repoinfo = await getRepoInfo(root);
    if (repoinfo.branch.startsWith("automerge/")) {
      console.error(`You are on automerge branch '${repoinfo.branch}', you probably want to select 'master' or 'main'`);
      process.exit(1);
    }
    if (repoinfo.branch.startsWith("edge/")) {
      console.error(`You are on edge branch '${repoinfo.branch}', you shouldn't need automerges for edge branches as we allow them to break`);
      process.exit(1);
    }

    const gitty = simpleGit({
      baseDir: root
    });

    if (repoinfo.branch.startsWith("feature/")) {
      // auto-create upstream branch if it doesn't exist yet

      const upstreamCmd = await executeGitCommand(["rev-parse", "--abbrev-ref", `${repoinfo.branch}@{upstream}`], { workingdir: root });
      if (upstreamCmd.exitcode !== 0) {
        console.log(`No upstream branch set for ${repoinfo.branch}, setting it now`);
        // there is no upstream branch yet. List the branches, find origin/main of origin/master
        const branches = await gitty.branch();
        const origMainBranch = branches.all.find(b => ["remotes/origin/master", "remotes/origin/main"].includes(b));
        if (!origMainBranch) {
          console.error(`Could not find remotes/origin/main or remotes/origin/master`);
          process.exit(1);
        }

        // Create the upstream for the current branch, position it at the fork point of the current branch and origin/(master/main)
        if (!branches.all.includes(`remotes/origin/${repoinfo.branch}`)) {
          // Find the common ancestor of the current branch and the (remote) main branch
          const forkPointCmd = await executeGitCommand(["merge-base", "--fork-point", origMainBranch, `${repoinfo.branch}`], { workingdir: root });
          if (forkPointCmd.exitcode) {
            console.error(`Could not find fork point of ${repoinfo.branch} and ${origMainBranch}: ${forkPointCmd.output}:\n` + forkPointCmd.output);
            process.exit(1);
          }

          const forkPoint = forkPointCmd.output.trim();

          const pushoptions = ["--force"];
          if (!verbose)
            pushoptions.push("--quiet");

          console.log(`Creating upstream branch ${repoinfo.branch} at fork point ${forkPoint}`);
          const pushRes = await executeGitCommandForeground(["push", ...pushoptions, "origin", `${forkPoint}:refs/heads/${repoinfo.branch}`], { workingdir: root });
          if (pushRes) {
            console.error(`Could not push branch ${repoinfo.branch} as fork point ${forkPoint} to origin: ${pushRes}`);
            process.exit(1);
          }
        }

        console.log(`Setting upstream branch for ${repoinfo.branch} to remotes/origin/${repoinfo.branch}`);
        const setUpstreamRes = await executeGitCommandForeground(["branch", "--set-upstream-to", `remotes/origin/${repoinfo.branch}`, repoinfo.branch], { workingdir: root });
        if (setUpstreamRes) {
          console.error(`Could not set upstream branch for ${repoinfo.branch} to remotes/origin/${repoinfo.branch}: ${setUpstreamRes}`);
          process.exit(1);
        }
      }
    }

    if (!opts.noRebase) {
      //Ensure things are up-to-date. automerge.whscr did quite a bit of work but I'm not sure why we can't just have git do it..
      //TODO a bit less noise if we fetch first and then see if we need to rebase. pull combines fetch&rebase
      const exitcode = await executeGitCommandForeground(["pull", "--rebase=merges", "--quiet"], { workingdir: root });
      if (exitcode !== 0) {
        console.error(`Could not pull from remote repository: ${exitcode}`);
        process.exit(1);
      }
    }

    repoinfo = await getRepoInfo(root); //up-to-date
    if (repoinfo.head_oid === repoinfo.origin_oid) {
      console.log(`Current commit (${shortLogMessage(repoinfo.commits[0]?.message)}) has already been merged`);
      process.exit(0);
    }

    const newcommits = [];
    for (const commit of repoinfo.commits) {
      if (commit.id === repoinfo.origin_oid)
        break;
      newcommits.push(commit);
    }

    if (verbose)
      console.log(newcommits);

    const config = await getAutomergeConfig(repoinfo.remote_url);
    const pushbranch = `automerge/${config.user}/${repoinfo.branch}`;

    const remote_pushbranch_res = await executeGitCommand(["ls-remote", "--quiet", "origin", pushbranch], { workingdir: root });
    const remote_pushbranch_sha = remote_pushbranch_res.output.split('\t')[0];
    if (remote_pushbranch_sha !== repoinfo.head_oid) {
      const branchres = await executeGitCommandForeground(["branch", "-f", pushbranch, repoinfo.branch], { workingdir: root });
      if (branchres !== 0) {
        console.error(`Could not create branch ${pushbranch}: ${branchres}`);
        process.exit(1);
      }

      const pushoptions = ["-u", "--force"];
      if (!verbose)
        pushoptions.push("--quiet");

      const pushres = await executeGitCommandForeground(["push", ...pushoptions, "origin", pushbranch], { workingdir: root });
      if (pushres !== 0) {
        console.error(`Could not push branch ${pushbranch}: ${pushres}`);
        process.exit(1);
      }
    }

    const gitlabclient = new Gitlab({ host: config.apiroot, token: config.token });
    if (verbose)
      console.log(`Looking up pending merge request`);

    let self;
    try {
      self = await gitlabclient.Users.showCurrentUser();
    } catch (e) {
      console.error(`Could not look up current user. Token expired?: ${e}`);
      console.error(`You can set up a new API token for forge ${config.apiroot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
      process.exit(1);
    }

    let mergerequest: MergeRequestSchema = (await gitlabclient.MergeRequests.all({
      projectId: config.project,
      state: 'opened',
      scope: 'created_by_me',
      sourceBranch: pushbranch,
      targetBranch: repoinfo.branch
    }))[0];

    if (!mergerequest) {
      console.log("Need to create a new merge request");

      let title = '';
      if (newcommits.length > 1)
        title = `${newcommits.length} commits: `;
      title += newcommits.map(c => shortLogMessage(c.message)).join(', ');
      title = title.substring(0, 80);

      mergerequest = await gitlabclient.MergeRequests.create(config.project, pushbranch, repoinfo.branch, title, {
        removeSourceBranch: true,
      });
      console.log(`New merge request !${mergerequest.iid} created - ${mergerequest.web_url} with status: ${mergerequest.merge_status}`);
    } else {
      console.log(`Have merge request !${mergerequest.iid}: - ${mergerequest.web_url}, status: ${mergerequest.merge_status}`);
    }

    //Check if the merge request contains a .gitlab-ci.yaml
    let hasCI = false;
    try {
      await gitlabclient.RepositoryFiles.show(config.project, ".gitlab-ci.yml", mergerequest.sha);
      hasCI = true;
    } catch (ignore) {
      //hasCI will remain false
      if (verbose)
        console.log(`No .gitlab-ci.yml found in merge request, not waiting for CI`);
    }

    if (hasCI) {
      //Wait for a pipeline to appear
      const waituntil = Date.now() + 30000; // Wait max 30 seconds for the pipeline to appear
      let pipeline: PipelineSchema | null = null;
      let cntr = 0;
      while (Date.now() < waituntil) {
        /* we're running into issues where MergeRequests.accept gives a 405 Method not allowed.,
          see if we need to wait for pipelines to move out of 'created' state first ...
          */
        const pipelines = await gitlabclient.Pipelines.all(config.project, { ref: pushbranch });
        pipeline = pipelines.find(p => p.sha === repoinfo.head_oid && p.status !== "created") || null;
        if (pipeline)
          break;
        await sleep(250);
        if ((cntr++) % 4 === 0)
          console.log(`Waiting for pipeline to appear...`);
      }

      if (!pipeline) {
        console.error(`Pipeline didn't appear - check ${mergerequest.web_url}`);
        process.exit(1);
      }
      if (pipeline.status === "failed") {
        console.error(`CI run for this commit has failed - check ${mergerequest.web_url}`);
        process.exit(1);
      }
      console.log("Pipeline status: " + pipeline.status);
    }

    //Wait for merge request to go out of 'checking' state
    for (; ;) {
      mergerequest = await gitlabclient.MergeRequests.show(config.project, mergerequest.iid);
      logDebug("devkit:automerge", { mergerequest });
      console.log(`MR status: ${mergerequest.merge_status}, detailed: ${mergerequest.detailed_merge_status}`);
      if (!(mergerequest.merge_status === "checking" || mergerequest.merge_status === "unchecked"))
        break;

      await sleep(250);
      mergerequest = await gitlabclient.MergeRequests.show(config.project, mergerequest.iid);
    }

    //Log merge request status to see if we can figure out why accept gets entity errors
    if (verbose)
      console.log(pick(mergerequest, ["merge_status", "detailed_merge_status"]));

    if (hasCI) {
      //Ignore 401 Unauthorized, just assume we're not allowed to merge on success
      if (!await handleError(gitlabclient.MergeRequests.accept(config.project, mergerequest.iid, { mergeWhenPipelineSucceeds: true }), { 401: null })) {
        console.log(`Cannot set !${mergerequest.iid} to automerge, ignoring`);
      } else {
        //If we were able to set mergeWhenPipelineSucceeds, we should self-assign. otherwise someone else should be reviewing
        await gitlabclient.MergeRequests.edit(config.project, mergerequest.iid, { assigneeId: self.id });
      }
    } else {
      await gitlabclient.MergeRequests.accept(config.project, mergerequest.iid);
    }

    process.exit(0); //TODO without this we hang after the first gitlab request. not sure why
  }
});
