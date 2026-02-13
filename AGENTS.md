# Agent instructions
Instructions for agents working on the WebHare Platform (this project)

Directory structure:
- `whtree/jssdk/<package>/` - TypeScript SDK for WebHare. Imported in JS/TS as `@webhare/<package>`
- `whtree/modules/<module>/` - Location of built in modules. Referred to using resource path `mod::<module>/...`

New scripts, command line tools etc should prefer TypeScript. HareScript is deprecated

Command line tools must use `@webhare/cli` for option and argument parsing.

Command line tools are generally stored in `<module directory>/scripts/whcommands`.
