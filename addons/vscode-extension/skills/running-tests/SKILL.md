---
name: running-tests
description: Run a TypeScript (.ts/.tsx) or HareScript (.whscr) test or validate the code in these files
---

WebHare (modules) use a customized test runner. This test runner is used for 'backend' tests (run directly in the terminal) or 'frontend' tests (started in a terminal but running in a usually headless browser)

To validate a file (which should be done before running it) use the `webhare_validate` tool for HareScript files (`*.whscr`). Specify the full path to the test file as the argument.

Use the `get_errors` tool to validate TypeScript files before running.

To validate a module completely use the `webhare_checkmodule` tool. This tool is too slow for individual files and is not a replacement for actually running tests

To run a test use the `webhare_runtest` tool. Specify the full path to the test file as the argument
