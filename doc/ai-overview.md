# AI Overview
List of integration points for AI in WebHare.

## Platform development
- `AGENTS.md` in the root to give general development guidelines
- `.vscode/settings.json` adds the vscode extension's prompts and skills folder for us too.

## VSCode extension
- `addons/vscode-extension/prompts/` contains prompts we ship in our extension
- `addons/vscode-extension/skills/` contains shareable skills

See the [package.json](../addons/vscode-extension/package.json) for the chatSkills and chatPrompts contribution points. These need to be
updated whenever a new skill/prompt is added.

Skills should follow the [Agent skills](https://agentskills.io/specification) specification.

## Known issues/potential improvements?
If you update a prompt to test it for a module you'll have to go either:
- run the 'Install VSCode Extension' task and restart/reload the window
- run the 'Debug: Start Debugging' command and load a project into the debug window

Or copypaste the prompt into an agent chat. Can we reduce developer friction here?

Note that recompilation is not needed when using the skills/prompts inside the Platform project
as our `.vscode/settings.json` file directly references them
