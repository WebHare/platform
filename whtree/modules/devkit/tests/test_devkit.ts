import { getAPIForRepo } from "@mod-devkit/lib/internal/deploy/devsupport";
import { getNewTokenURL, isGitHubForge } from "@mod-devkit/lib/internal/deploy/github";
import * as test from "@webhare/test-backend";

async function testAutomergeAPIs() {
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("git@gitlab.webhare.com:group/project.git"));
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("ssh://git@gitlab.webhare.com:group/project.git"));
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("git@gitlab.webhare.com:group/project"));
  test.eq(null, getAPIForRepo("git@gitlab.webhare.com:group/project.gi"));
  test.eq({ apiRoot: "https://github.com", project: "owner/repo" }, getAPIForRepo("git@github.com:owner/repo.git"));
}

async function testGitHubHelpers() {
  test.assert(isGitHubForge("https://github.com"));
  test.assert(isGitHubForge("https://GitHub.com/"));
  test.assert(!isGitHubForge("https://gitlab.webhare.com"));
  test.assert(!isGitHubForge("https://github.example.com"));

  const url = new URL(getNewTokenURL());
  test.eq("https://github.com/settings/personal-access-tokens/new", url.origin + url.pathname);
  test.eq("write", url.searchParams.get("contents"));
  test.eq("write", url.searchParams.get("pull_requests"));
  test.eq("read", url.searchParams.get("actions"));
  test.eq(null, url.searchParams.get("target_name"));
}

test.runTests([
  testAutomergeAPIs,
  testGitHubHelpers
]);
