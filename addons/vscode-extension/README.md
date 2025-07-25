# WebHare extension for Visual Studio Code
WebHare extension for Visual Studio Code. This extension provides syntax definitions for HareScript files and a language client which connects to a WebHare installation.

## Features

This extension provides:

* Syntax highlighting for HareScript files
* File diagnostics for HareScript files and supported XML files
* Code actions to automatically add missing LOADLIBs, remove unused LOADLIBs and organize LOADLIBs
* Document formatter for supported XML files
* Documentation popups on hover
* Jump to definition
* A few snippets for inserting common code fragments
* Stack traces of the last error(s) in the notice log

## Installation (from source)
* Check out the WebHare source tree and build it
- `wh devkit:vscode-extension install`

## Configuration
The extension can be configured in the Settings, under _Extension_ > _WebHare_ or by searching for one of the setting keys.

### Webhare: Debug Loglevel
The WebHare `dev` module can log debugging information to the debug log with an `dev:lsp` log source value.
This setting can be used to control the amount of information that is being logged, from 0 (log only errors) to 3 (log everything).

## Other extensions to install
See https://www.webhare.dev/manuals/developers/vscode/

### Troubleshooting

* If the ESLint extension reports errors that some rules are not supported, check the path to your WebHare folder or
  module folder for lingering eslint installs in node_modules directories (eg in /Users/yourname/projects/node_modules).
  Also, make sure your global eslint is up to date (`npm install -g eslint). To determine which eslint is in use, enable
  debugging in the ESLint extension (open preferences, type 'eslint debug'). Then select 'ESLint' in the output window,
  it will show which eslint library is in use.
* If TypeScript files aren't validating properly (eg. not recognizing `@webhare` imports) run `wh checkmodule` on your module
