import { getRepoInfo } from '@mod-devkit/lib/internal/deploy/git';
import process from 'node:process';
import { Gitlab } from '@gitbeaker/rest';
import { runCli } from "@webhare/cli";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAutomergeConfig } from '@mod-devkit/lib/internal/deploy/devsupport';

function shortLogMessage(text: string) {
  text = text.split('\n')[0];
  if (text.length > 50)
    text = text.slice(0, 50) + '…';
  return text;
}

runCli({
  flags: {
    "v,verbose": "Verbose output",
    "no-rebase": "Do not rebase the current branch before merging"
  },
  options: {
    c: "Path to the git repository (defaults to current directory)",
    branch: "Branch to check (defaults to current branch)",
  },
  async main({ opts }) {
    const verbose: boolean = opts.verbose;

    let root = opts.c || process.cwd();
    while (root !== "/" && !existsSync(join(root, "/.git")))
      root = join(root, "..");
    if (root === '/') {
      console.error("Could not find the root of the current git repository, if any");
      process.exit(1);
    }

    const repoinfo = await getRepoInfo(root, { branch: opts.branch });
    if (repoinfo.head_oid !== repoinfo.origin_oid) {
      console.log(`Current commit (${shortLogMessage(repoinfo.commits[0]?.message)}) not pushed yet`);
      process.exit(0);
    }

    const config = await getAutomergeConfig(repoinfo.remote_url);
    const automergeBranch = `automerge/${config.user}/${repoinfo.branch}`;

    const gitlabclient = new Gitlab({ host: config.apiRoot, token: config.token });
    if (verbose)
      console.log(`Looking up pipeline`);

    const pipelines = await gitlabclient.Pipelines.all(config.project, { ref: repoinfo.branch });
    let current = pipelines.find(p => p.sha === repoinfo.head_oid);
    let branchName = `Merge branch ${repoinfo.branch}`;
    if (!current) {
      const automergePipelines = await gitlabclient.Pipelines.all(config.project, { ref: automergeBranch });
      current = automergePipelines.find(p => p.sha === repoinfo.head_oid);
      branchName = `Automerge branch ${automergeBranch}`;
    }
    if (!current) {
      console.log(`Could not find pipeline for current commit ${repoinfo.head_oid}`);
      process.exit(1);
    }

    switch (current.status) {
      case "created":
      case "waiting_for_resource":
      case "preparing":
      case "pending":
      case "running":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: still running (${current.status}${current.web_url ? `, ${current.web_url}` : ""})`);
        return;
      case "failed":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: failed: ${current.web_url}`);
        return;
      case "canceled":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: canceled`);
        return;
      case "skipped":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: skipped`);
        return;
      case "manual":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: waiting for manual action`);
        return;
      case "scheduled":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: scheduled to run later`);
        return;
      case "success":
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: succeeded`);
        break;
      default:
        console.log(`${branchName} commit ${repoinfo.head_oid.slice(0, 8)}: unknown status ${current.status}`);
    }
  }
});
