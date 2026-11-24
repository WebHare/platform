import { sleep } from "@webhare/std";
import { logDebug } from "@webhare/services";

/* GitHub support for devkit:automerge. Needs a fine-grained token with contents:write, pull_requests:write and actions:read.
   The 'Get token' link in the devkit:deploy forges app requests exactly these permissions (see forges.whlib) */

export function isGitHubForge(apiRoot: string) {
  return new URL(apiRoot).hostname.toLowerCase() === "github.com";
}

class GitHubError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Get the 'message' from a GitHub error response */
function getErrorMessage(body: unknown): string | undefined {
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : undefined;
}

interface GitHubPullRequest {
  number: number;
  node_id: string;
  html_url: string;
  user: { login: string } | null;
  /** Whether the pull request can be merged. null while GitHub is still computing it */
  mergeable?: boolean | null;
}

interface GitHubRepository {
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_squash_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  head_branch: string | null;
  status: string;
  conclusion: string | null;
  html_url: string;
}

class GitHubClient {
  private readonly token: string;
  private readonly apiBase = "https://api.github.com";

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.apiBase + path, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    //Error pages from GitHub or a proxy in between (eg. a 502) may not be JSON
    let result: unknown = null;
    if (text) {
      try {
        result = JSON.parse(text);
      } catch (e) {
        if (res.ok)
          throw new GitHubError(`GitHub API ${method} ${path} returned invalid JSON: ${(e as Error).message}`, res.status, text);
        result = text;
      }
    }
    logDebug("devkit:automerge", { method, path, status: res.status, result });
    if (!res.ok)
      throw new GitHubError(`GitHub API ${method} ${path} failed with status ${res.status}: ${getErrorMessage(result) ?? text}`, res.status, result);
    return result as T;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.request<{ data?: T; errors?: Array<{ message: string }> }>("POST", "/graphql", { query, variables });
    if (result.errors?.length)
      throw new GitHubError(result.errors.map(e => e.message).join(", "), 200, result);
    return result.data as T;
  }
}

export interface GitHubAutomergeOptions {
  apiRoot: string;
  token: string;
  /** 'owner/repo' */
  project: string;
  pushBranch: string;
  targetBranch: string;
  headOid: string;
  title: string;
  verbose: boolean;
}

/** Get the URL to create a fine-grained token with the permissions automerge needs
    @param owner - User or organization that owns the repositories the token should access. If not set, GitHub defaults to the current user
*/
export function getNewTokenURL(owner?: string) {
  const url = new URL("https://github.com/settings/personal-access-tokens/new");
  url.searchParams.set("name", "WebHare devkit");
  url.searchParams.set("description", "Used by WebHare devkit:automerge");
  if (owner)
    url.searchParams.set("target_name", owner);
  //Keep in sync with OnOpenNewToken in tolliumapps/deploy/forges.whlib
  url.searchParams.set("contents", "write");
  url.searchParams.set("pull_requests", "write");
  url.searchParams.set("actions", "read");
  return url.toString();
}

/** Create (or find) a pull request for the pushed automerge branch and merge it, or have GitHub merge it once its checks pass */
export async function automergeGitHub(opts: GitHubAutomergeOptions): Promise<void> {
  try {
    await runAutomerge(opts);
  } catch (e) {
    /* Reading public repositories works with any token, but writing needs the token to be granted access to the repository.
       A fine-grained token only covers repositories of the resource owner it was created for (by default: yourself) */
    if (e instanceof GitHubError && e.status === 403 && /not accessible by personal access token/i.test(getErrorMessage(e.body) ?? "")) {
      const [owner] = opts.project.split("/");
      console.error(`Your GitHub token for ${opts.apiRoot} has no write access to '${opts.project}' (${e.message})`);
      console.error(`Fine-grained tokens only work for the repositories of the owner selected as 'Resource owner' when creating them.`);
      console.error(`Create a token for '${owner}' with the 'contents' and 'pull requests' write permissions and 'actions' read permission: ${getNewTokenURL(owner)}`);
      console.error(`If '${owner}' is an organization, it may need to approve the token first. Then update the token in the dev deploy app: https://my.webhare.dev/?app=devkit:deploy/forges`);
      process.exit(1);
    }
    throw e;
  }
}

async function runAutomerge(opts: GitHubAutomergeOptions): Promise<void> {
  const client = new GitHubClient(opts.token);
  const [owner] = opts.project.split("/");
  const repoPath = `/repos/${opts.project}`;

  let self;
  try {
    self = await client.request<{ login: string }>("GET", "/user");
  } catch (e) {
    console.error(`Could not look up current user. Token expired?: ${(e as Error).message}`);
    console.error(`You can set up a new API token for forge ${opts.apiRoot} in the dev deploy app. https://my.webhare.dev/?app=devkit:deploy/forges`);
    process.exit(1);
  }

  if (opts.verbose)
    console.log(`Looking up pending pull request`);

  const openPRs = await client.request<GitHubPullRequest[]>("GET", `${repoPath}/pulls?state=open&head=${encodeURIComponent(`${owner}:${opts.pushBranch}`)}&base=${encodeURIComponent(opts.targetBranch)}`);
  let pr = openPRs.find(p => p.user?.login === self.login);
  if (!pr) {
    console.log("Need to create a new pull request");
    pr = await client.request<GitHubPullRequest>("POST", `${repoPath}/pulls`, { title: opts.title, head: opts.pushBranch, base: opts.targetBranch });
    console.log(`New pull request #${pr.number} created - ${pr.html_url}`);
  } else {
    console.log(`Have pull request #${pr.number} - ${pr.html_url}`);
  }

  const repo = await client.request<GitHubRepository>("GET", repoPath);

  //Check if the repository has GitHub Actions workflows at this commit
  let hasCI = false;
  try {
    const workflows = await client.request<Array<{ name: string }>>("GET", `${repoPath}/contents/.github/workflows?ref=${opts.headOid}`);
    hasCI = workflows.some(w => w.name.endsWith(".yml") || w.name.endsWith(".yaml"));
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404))
      throw e;
  }
  if (!hasCI && opts.verbose)
    console.log(`No GitHub Actions workflows found in pull request, not waiting for CI`);

  let runs: GitHubWorkflowRun[] = [];
  if (hasCI) {
    runs = await getWorkflowRuns(client, repoPath, opts);
    if (runs.length) {
      checkWorkflowRuns(runs);
      console.log("Workflow runs: " + runs.map(r => `${r.name}: ${r.conclusion ?? r.status}`).join(", "));
    } else if (opts.verbose)
      console.log(`No workflow runs found for this commit yet`);
  }

  const mergeMethod = await getMergeMethod(client, repoPath, repo, opts.targetBranch);
  /* Right after the push GitHub usually hasn't created the workflow runs yet, so with workflows but no runs CI is still pending.
     Only merge right away if there's no CI or all runs have finished successfully */
  const ciDone = !hasCI || (runs.length > 0 && runs.every(r => r.status === "completed"));
  if (ciDone) {
    await mergeNow(client, repoPath, pr, opts, mergeMethod);
    return;
  }

  //Ask GitHub to merge when the required checks pass. That needs 'Allow auto-merge' on the repository and the PR to be blocked by required checks
  if (repo.allow_auto_merge) {
    let autoMerge = false;
    try {
      await client.graphql(`mutation($id: ID!, $method: PullRequestMergeMethod!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId }
        }`, { id: pr.node_id, method: mergeMethod.toUpperCase() });
      autoMerge = true;
    } catch (e) {
      /* Also fails if the PR is already mergeable because the target branch has no required checks ('clean status').
         GitHub would then merge immediately without waiting for the running CI, so wait for it ourselves */
      if (opts.verbose)
        console.log(`Cannot set #${pr.number} to auto-merge (${(e as Error).message}), waiting for CI instead`);
    }

    if (autoMerge) {
      console.log(`Pull request #${pr.number} will be merged when its checks pass`);
      if (!repo.delete_branch_on_merge)
        console.log(`The repository doesn't delete merged branches automatically, so branch '${opts.pushBranch}' will remain after the merge`);
      //If we were able to enable auto-merge, we should self-assign. otherwise someone else should be reviewing
      try {
        await client.request("POST", `${repoPath}/issues/${pr.number}/assignees`, { assignees: [self.login] });
      } catch (e) {
        console.log(`Cannot assign #${pr.number} to yourself: ${(e as Error).message}`);
      }
      return;
    }
  }

  //Wait for CI ourselves and merge when it has passed, just like GitLab's 'merge when pipeline succeeds' would
  console.log(`Waiting for CI to finish (you can interrupt this and merge it yourself: ${pr.html_url})`);
  /* Look the runs up again on every iteration: runs created after the first lookup (eg. the pull request's runs) need to finish too */
  const noRunsDeadline = Date.now() + 5 * 60 * 1000;
  for (let cntr = 0; !(runs.length > 0 && runs.every(r => r.status === "completed")); ++cntr) {
    if (!runs.length && Date.now() > noRunsDeadline) {
      console.error(`No workflow runs appeared for this commit within 5 minutes. The repository's workflows may not run for pushes to '${opts.pushBranch}' or for pull requests. Please check and merge #${pr.number} yourself: ${pr.html_url}`);
      process.exit(1);
    }
    await sleep(10000);
    runs = await getWorkflowRuns(client, repoPath, opts);
    checkWorkflowRuns(runs);
    if (cntr % 6 === 5)
      console.log("Workflow runs: " + (runs.length ? runs.map(r => `${r.name}: ${r.conclusion ?? r.status}`).join(", ") : "none yet"));
  }
  await mergeNow(client, repoPath, pr, opts, mergeMethod);
}

/** Get the workflow runs for the commit on the automerge branch */
async function getWorkflowRuns(client: GitHubClient, repoPath: string, opts: GitHubAutomergeOptions): Promise<GitHubWorkflowRun[]> {
  /* head_sha also finds runs for other pushes of the same commit (eg. to the feature branch the commit came from) which may have
     completed already, so only count runs for the automerge branch: its push runs and the pull request's runs */
  const all = (await client.request<{ workflow_runs: GitHubWorkflowRun[] }>("GET", `${repoPath}/actions/runs?head_sha=${opts.headOid}&per_page=100`)).workflow_runs;
  return all.filter(r => r.head_branch === opts.pushBranch);
}

/** Exit if any of the runs has failed */
function checkWorkflowRuns(runs: GitHubWorkflowRun[]) {
  const failed = runs.find(r => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion ?? ""));
  if (failed) {
    console.error(`CI run '${failed.name}' for this commit has failed (${failed.conclusion}) - check ${failed.html_url}`);
    process.exit(1);
  }
}

/** Pick a merge method allowed by both the repository and the target branch's rulesets, preferring a merge commit as that keeps the original commit ids */
async function getMergeMethod(client: GitHubClient, repoPath: string, repo: GitHubRepository, targetBranch: string): Promise<"merge" | "rebase" | "squash"> {
  let rulesetMethods: string[] | null = null;
  try {
    const rules = await client.request<Array<{ type: string; parameters?: { allowed_merge_methods?: string[] } }>>("GET", `${repoPath}/rules/branches/${encodeURIComponent(targetBranch)}`);
    for (const rule of rules) {
      const allowed = rule.type === "pull_request" ? rule.parameters?.allowed_merge_methods : undefined;
      if (allowed) //Every ruleset must allow the method
        rulesetMethods = rulesetMethods ? rulesetMethods.filter(m => allowed.includes(m)) : allowed;
    }
  } catch (e) {
    if (!(e instanceof GitHubError && [403, 404].includes(e.status)))
      throw e;
  }

  const candidates = [
    { method: "merge" as const, allowed: repo.allow_merge_commit },
    { method: "rebase" as const, allowed: repo.allow_rebase_merge },
    { method: "squash" as const, allowed: repo.allow_squash_merge }
  ];
  //Treat a missing allow_ flag as allowed: GitHub may leave them out depending on our access to the repository
  const usable = candidates.filter(c => c.allowed !== false && (!rulesetMethods || rulesetMethods.includes(c.method)));
  return usable[0]?.method ?? "merge";
}

async function mergeNow(client: GitHubClient, repoPath: string, pr: GitHubPullRequest, opts: GitHubAutomergeOptions, mergeMethod: "merge" | "rebase" | "squash") {
  //GitHub computes whether a new (or just updated) pull request is mergeable in the background, and refuses to merge until it has
  for (const waitUntil = Date.now() + 30000; Date.now() < waitUntil;) {
    const current = await client.request<GitHubPullRequest>("GET", `${repoPath}/pulls/${pr.number}`);
    if (current.mergeable !== null && current.mergeable !== undefined)
      break;
    await sleep(1000);
  }

  try {
    //Pin the merge to the commit we pushed and checked. pr.head.sha may still be the previous head right after a force-push
    await client.request("PUT", `${repoPath}/pulls/${pr.number}/merge`, { sha: opts.headOid, merge_method: mergeMethod });
  } catch (e) {
    if (e instanceof GitHubError && [403, 405, 409].includes(e.status)) {
      console.error(`Cannot merge #${pr.number}: ${getErrorMessage(e.body) ?? e.message} - check ${pr.html_url}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`Pull request #${pr.number} merged`);

  //Remove the automerge branch (ignore failures, the repository may already delete merged branches itself)
  try {
    await client.request("DELETE", `${repoPath}/git/refs/heads/${opts.pushBranch.split("/").map(encodeURIComponent).join("/")}`);
  } catch (ignore) {
  }
}
