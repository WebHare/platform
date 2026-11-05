# Agent instructions
Instructions for agents working on the WebHare Platform (this project)

Directory structure:
- `whtree/jssdk/<package>/` - TypeScript SDK for WebHare. Imported in JS/TS as `@webhare/<package>`
- `whtree/modules/<module>/` - Location of built in modules. Referred to using resource path `mod::<module>/...`

New scripts, command line tools etc should prefer TypeScript. HareScript is deprecated

Command line tools must use `@webhare/cli` for option and argument parsing.

Command line tools are generally stored in `<module directory>/scripts/whcommands`.

Test/CI code must use the following test libraries/TypeScript imports and import them into the test namespace (import * as test from "..."):
- `@webhare/test` - Generic test APIs for both browser and server side code
- `@webhare/test-frontend` - Test APIs specifically for frontend/browser code
- `@webhare/test-backend` - Test APIs specifically for backend/server-side code
- `@mod-webhare_testsuite/js/wts-backend.ts` - Test APIs specifically for backend/server-side code living in the `webhare_testsuite` module

## Skills
Skills are kept in two places, depending on who needs them:
- `.agents/skills/` (this repository) - skills that are only useful when developing the WebHare platform itself,
  eg. how the JSSDK is organized and built.
- The `webhare_dev` module, in `content/ai/skills/` - skills useful to anyone developing WebHare modules, add-ons and
  applications, even if the API they describe is implemented in this repository (eg. siteprofiles, widgets, WRD, routers).

Before adding or changing a skill in either place, read `content/ai/skills/maintaining-skills/SKILL.md` in the
`webhare_dev` module.

The `webhare_dev` module may not be installed. Run `wh getmoduledir webhare_dev` to find it. If that fails,
the module needs to be checked out from https://github.com/WebHare/webhare_dev and installed first. Ask the user to
do that rather than putting module-developer skills in `.agents/skills/` instead.

## HareScript
Files with the `.whscr` and `.whlib` extension contain HareScript code
