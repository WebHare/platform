import { getAPIForRepo } from "@mod-devkit/lib/internal/deploy/devsupport";
import * as test from "@webhare/test-backend";

async function testAutomergeAPIs() {
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("git@gitlab.webhare.com:group/project.git"));
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("ssh://git@gitlab.webhare.com:group/project.git"));
  test.eq({ apiRoot: "https://gitlab.webhare.com", project: "group/project" }, getAPIForRepo("git@gitlab.webhare.com:group/project"));
  test.eq(null, getAPIForRepo("git@gitlab.webhare.com:group/project.gi"));
}

test.runTests([
  testAutomergeAPIs
]);
