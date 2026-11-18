// Posts (or updates) a single comment on a pull request listing the container images deployed for its head commit.
// Used by ci.yml (after the deploy job pushed the images) and pr-image-comment.yml (when the PR is opened after the deploy already finished)

const fs = require("node:fs");

const MARKER = "<!-- webhare-deployed-images -->";

/** @param {{ sha: string; build_image: string; branch_images: string[]; public_images: string[] }} images */
function formatBody(images) {
  const lines = [
    MARKER,
    `### Container image for ${images.sha}`,
    "",
    "All tests passed and the following images have been pushed:",
    "",
    `- \`${images.build_image}\` (this commit)`,
    ...images.branch_images.map(image => `- \`${image}\` (latest build of this branch)`),
    ...images.public_images.map(image => `- \`${image}\` (public)`),
    "",
    "For WebHare developers:",
    "```",
    `SV install -s ${images.build_image} <server>`,
    `wh testcontainer -w ${images.build_image} -m <module>`,
    "```",
  ];
  return lines.join("\n");
}

async function upsertComment({ github, context, core }, prNumber, images) {
  const { owner, repo } = context.repo;
  const body = formatBody(images);
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
  const existing = comments.find(comment => comment.user?.type === "Bot" && comment.body?.startsWith(MARKER));
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    core.info(`Updated image comment on PR #${prNumber}`);
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    core.info(`Posted image comment on PR #${prNumber}`);
  }
}

/** Called by the deploy job. Stores the image list for pr-image-comment.yml and comments on open PRs for the branch */
async function afterDeploy({ github, context, core }) {
  const split = str => (str || "").split(/\s+/).filter(Boolean);
  const images = {
    sha: process.env.CI_COMMIT_SHA,
    build_image: process.env.BUILD_IMAGE,
    branch_images: split(process.env.BRANCH_IMAGES),
    public_images: split(process.env.PUBLIC_IMAGES),
  };
  fs.mkdirSync("deployed-images", { recursive: true });
  fs.writeFileSync("deployed-images/images.json", JSON.stringify(images, null, 2));

  const { owner, repo } = context.repo;
  const branch = process.env.CI_COMMIT_REF_NAME;
  const prs = await github.paginate(github.rest.pulls.list, { owner, repo, head: `${owner}:${branch}`, state: "open", per_page: 100 });
  if (!prs.length)
    core.info(`No open PR for ${branch} yet - pr-image-comment.yml will comment when one is opened`);

  for (const pr of prs) {
    if (pr.head.sha !== images.sha) { // a newer commit has been pushed, its own deploy will comment
      core.info(`Skipping PR #${pr.number}, its head is now ${pr.head.sha}`);
      continue;
    }
    await upsertComment({ github, context, core }, pr.number, images);
  }
}

/** Called when a PR is opened. Finds the run that deployed the PR's head commit, so pr-image-comment.yml can download its image list */
async function findDeployRun({ github, context, core }) {
  const { owner, repo } = context.repo;
  const head_sha = context.payload.pull_request.head.sha;
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, head_sha, event: "push", per_page: 100 });
  runs.sort((a, b) => b.run_number - a.run_number);
  for (const run of runs) {
    const { data } = await github.rest.actions.listWorkflowRunArtifacts({ owner, repo, run_id: run.id, name: "deployed-images" });
    if (data.artifacts.some(artifact => !artifact.expired)) {
      core.info(`Commit ${head_sha} was deployed by run ${run.html_url}`);
      return String(run.id);
    }
  }
  core.info(`Commit ${head_sha} has not been deployed (yet) - the deploy job will comment when it finishes`);
  return "";
}

/** Called after pr-image-comment.yml downloaded the image list */
async function onPullRequest({ github, context, core }) {
  const images = JSON.parse(fs.readFileSync("deployed-images/images.json", "utf8"));
  if (images.sha !== context.payload.pull_request.head.sha)
    return core.warning(`Downloaded image list is for ${images.sha}, not the PR head`);
  await upsertComment({ github, context, core }, context.payload.pull_request.number, images);
}

module.exports = { afterDeploy, findDeployRun, onPullRequest };
