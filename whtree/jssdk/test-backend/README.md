# @webhare/test-backend

Backend test helpers, including all exports from `@webhare/test`.

## Temporary webserver ports

`createWebserverPort()` creates temporary database-backed webservers, commits
their configuration, reloads the webserver and checks that the listener can be
reached. Call it outside an open transaction.
