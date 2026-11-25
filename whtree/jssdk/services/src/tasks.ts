/* Task APIs moved to @webhare/tasks. This file only remains for modules that imported the internal
   @webhare/services/src/tasks path and only re-exports what those modules still use. */

// Not deprecated yet, see the 'Platform deprecations' plan. Import these from @webhare/tasks in new code
export { scheduleTask, scheduleTimedTask, retrieveTaskResult } from "@webhare/tasks";
