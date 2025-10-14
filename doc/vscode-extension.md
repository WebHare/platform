## Development
* The project can be run in the debugger using _Run_ > _Start Debugging_ (F5) (by default it should use the "Launch Client" launch configuration in _View_ > _Run_ > "Launch Client")
- Open a WebHare module in the now started extension host and test there! Or just develop as usual until you hit an issue
* After making changes to the extension, restart the debugging process to reload the extension. (usually; Shift-F5, F5)
  - Beware that Shift-F5 may(will?) not retain unsaved changes, it's a hard crash of that VSCode workspace.
* Activate your changes globally using `Run Task > Install WebHare VSCode extension`. Your changes will now affect all newly started windows, not just the one you're debugging

### Publishing it
- Pulisher page: https://marketplace.visualstudio.com/manage/publishers/WebHare
- PAT aanmaken: https://dev.azure.com/webhare/_usersSettings/tokens

```bash
whcd
cd addons/vscode-extension
./node_modules/.bin/vsce login webhare
./node_modules/.bin/vsce package --no-dependencies
./node_modules/.bin/vsce publish --no-dependencies
```

## Manual testing
To verify webhare-language-vscode is working:
- Run Task > Install WebHare VSCode extension
- Restart extension host
- Open a whlib. Verify you see syntax highlighting
- Break code. Eg split a funtionname into two with a space. You should see errors appear (red squiggly lines) and be able to hover over the error

## Resetting VSCode integration
To *backup* your VS Code installation completely (for testing bootstrap):

```bash
# Ensure you've shut down Code first!
BACKUPTO="$HOME/vscode-backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUPTO
> $BACKUPTO/"This dir contains dotfiles, use ls -la" # you'll thank yourself later
mv $HOME/.vsce $BACKUPTO/     # may not exist. extension publisher token
mv $HOME/.vscode $BACKUPTO/
mv ~/Library/Preferences/com.microsoft.VSCode.plist $BACKUPTO/
mv ~/Library/Application\ Support/Code $BACKUPTO/
```

To fully cleanup everything installed by setup-vscode, you should also:
```bash
brew uninstall --cask visual-studio-code
rm -rf ~/projects/webhare-language-vscode/
```
