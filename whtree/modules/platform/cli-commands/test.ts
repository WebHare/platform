// @webhare/cli: Testing and test user support

import { CLIRuntimeError, runCli } from "@webhare/cli";
import { dtapStage } from "@webhare/env";
import { generateTestPageToken } from "@webhare/test-backend/src/support";
import { createTestUser, createTestUserLoginLink, findTestUser, TestUserError } from "@webhare/auth/src/testusers";
import YAML from "yaml";

function refuseOnProduction() {
  if (dtapStage === "production")
    throw new CLIRuntimeError("Test users cannot be created on a production server");
}

/** Report expected test user failures without a stack trace */
async function reportErrors(task: () => Promise<void>) {
  try {
    await task();
  } catch (e) {
    if (e instanceof TestUserError)
      throw new CLIRuntimeError(e.message);
    throw e;
  }
}

function output(data: object, json: boolean) {
  console.log(json ? JSON.stringify(data, null, 2) : YAML.stringify(data).trimEnd());
}

const linkDescription = "URL to log in to and redirect to. https://my.webhare.dev/ refers to this installation's backend";

runCli({
  flags: {
    "v,verbose": "Show more info",
  },
  subCommands: {
    "generate-token": {
      description: "Generate a testpage token",
      async main({ opts, args }) {
        console.log(generateTestPageToken());
      }
    },
    "create-user": {
      shortDescription: "Create a temporary test user",
      description: "Create a temporary test user. The user is closed when a login started now would expire (usually the next day)",
      flags: {
        "j,json": "Output in JSON format"
      },
      options: {
        "schema": "WRD schema to create the user in (defaults to the primary user management schema)",
        "right": { description: "Global right to grant (repeatable)", multiple: true },
        "role": { description: "Role to grant, by wrdTag or title (repeatable)", multiple: true },
        "link": linkDescription
      },
      async main({ opts }) {
        refuseOnProduction();
        await reportErrors(async () => {
          const user = await createTestUser({ schema: opts.schema, rights: opts.right, roles: opts.role });
          const loginLink = opts.link ? (await createTestUserLoginLink(user.wrdId, opts.link, { schema: opts.schema })).loginLink : undefined;
          output({ wrdGuid: user.wrdGuid, username: user.username, ...(loginLink ? { loginLink } : {}) }, opts.json);
        });
      }
    },
    "create-link": {
      shortDescription: "Create an autologin link for a test user",
      flags: {
        "j,json": "Output in JSON format"
      },
      options: {
        "schema": "WRD schema containing the user (defaults to the primary user management schema)"
      },
      arguments: [
        { name: "<user>", description: "Test user: wrdId, wrdGuid, login name, or login name without @beta.webhare.net" },
        { name: "<link>", description: linkDescription }
      ],
      async main({ opts, args }) {
        refuseOnProduction();
        await reportErrors(async () => {
          const user = await findTestUser(args.user, { schema: opts.schema });
          const { loginLink } = await createTestUserLoginLink(user.wrdId, args.link, { schema: opts.schema });
          output({ wrdGuid: user.wrdGuid, username: user.username, loginLink }, opts.json);
        });
      }
    }
  }
});
