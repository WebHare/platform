# Services and tasks tasks

## Managed tasks
Managed tasks are single shot tasks managed on a central queue. A managed task
consists of either HareScript of JavaScript code. Outgoing emails and form
result handling are examples of managed tasks.

The managed task queue is stored in the database, and the task will be invoked
whether or not the requesting script is still running. The queue manager will
automatically retry tasks that failed due to an exception (or tasks that explicitly
requested a restart).

A managed task is always run inside a transaction. If a task completes
successfully, it's removed from the task queue in the same transaction as the
task itself was running. This ensures that any database modifications made by
the task are atomic (the task cannot be removed from the queue without having
its modifications apply, or have its modifications applied twice).

External side effects (eg webservice calls, SMTP connections) _are_ repeated
if a task fails before it is dequeued, so tasks communicating with external
services should be careful not to do anything which might cause them to fail
completing.

### Setup
A managedtask type is declared in moduledefinition.xml in the `<servicemanager>` section:

```xml
  <servicemanager>
    <managedtask type="mytask" objectname="lib/internal/tasks.whlib#MyTask"/>
  </servicemanager>
```

A task object must derive from %ManagedTaskBase and override the RunTask function.
This object is recreated for every task but its VM is not necessarily created
so global variables and TCP connections may be reused (though it's not guaranteed
that subsequent tasks will all run in the same HareScript VM)

```harescript
PUBLIC OBJECTTYPE MyTask EXTEND ManagedTaskBase
<
  UPDATE PUBLIC MACRO RunTask(RECORD taskdata)
  {
    this->ResolveByCompletion(CELL[ pong := taskdata.ping ]);
  }
>;
```

A task must execute one (and only one) of the `Resolve...` calls offered by %ManagedTaskBase.
If the task does not specify any resolution or fails due to an exception or HareScript error,
it will be requeued.

A managed task is queued by calling %ScheduleManagedTask during an open transaction, eg:

```harescript
ScheduleManagedTask("mymodule:mytask", [ ping := 42 ]);
```

You can check on the progress of managed tasks in WebHare's dashboard.

### Ephemeral tasks
Ephemeral tasks are similar to managed tasks but their invoker will generally
wait for the task to complete and process its result (where managed tasks can
be 'fire and forget'). Ephemeral tasks may be killed if the script listening
for the task result goes away before the task is completed. Assetpack compilation is an example of an ephemeral task.

Ephemeral tasks are declared similar to managedtasks. You need to use `<ephemeraltask>` in the module definition
and %ScheduleEphemeralTask to actually invoke the task.

## Scheduled tasks
Scheduled tasks run at predefined times. They are defined by a task in the
`<servicemanager>` section of the moduledefinition:

```xml
  <!-- Defines a task that runs at 00:13 UTC -->
  <task runat="13 0 * * *"  tag="updates" script="scripts/tasks/updates.whscr" />
  <!-- Defines a task that runs every monday at 15:00 Amsterdam time -->
  <task runat="0 15 * * 1"  runtz="Europe/Amsterdam" tag="mondays" script="scripts/tasks/mondays.whscr" />
  <!-- Defines a task that runs at 00:45 in the special 'maintenance' timezone -->
  <task runat="45 0 * * *"  runtz="maintenance" tag="maintenance" script="scripts/tasks/maintenance.whscr" />
```

The `runat` field is a crontab-like mask. See %GetNextCronTime for more information
about the supported formats.

The `maintenance` timezone is a special timezone which matches UTC but is offset
by the amount of minutes specified in the `WEBHARE_MAINTENANCE_OFFSET` environment
variable. This can be used to prevent multiple servers running heavy maintenance
tasks all at the same time.
