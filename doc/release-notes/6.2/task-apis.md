## Breaking changes

### Task APIs moved to `@webhare/tasks`
The managed and timed task APIs moved from `@webhare/services` to the new `@webhare/tasks` package, which also exports
`flushTasks` to wait for all pending tasks of the given types. Import task APIs from `@webhare/tasks` in new code.

`@webhare/services` still re-exports `TaskRequest`, `TaskResponse`, `scheduleTask`, `scheduleTimedTask`,
`retrieveTaskResult`, `cancelTask`, `listTasks` and `describeTask`, but no longer exports `retryTask`,
`cancelManagedTasks` and `TaskFunction`. Import `retryTask` and `TaskFunction` from `@webhare/tasks` instead. The
deprecated `cancelManagedTasks` is gone: use `cancelTask`, whose result offers `tasksCancelled()` instead of
`runningTasksStopped()`. The internal `@webhare/services/src/tasks` path now only offers
`scheduleTask`, `scheduleTimedTask` and `retrieveTaskResult`.
