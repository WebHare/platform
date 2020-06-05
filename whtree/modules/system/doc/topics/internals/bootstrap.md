# WebHare bootstrap

This document attemps to give an outline of the current WebHare startup process.
It may go out of date fast, so always check the code too

## Using PostgreSQL
Database selection, first of:
1. If the postgresql data dir exists, WebHare will select the PostgreSQL database server
2. If the dbase dir exists, WebHare will select dbserver
3. If `WEBHARE_INITIALDB` is set to `postgresql`, WebHare will select PostgreSQL
4. WebHare will select dbserver

To initialize with postgresql (make sure you don't have a dbase directory yet!)

```bash
WEBHARE_INITIALDB=postgresql wh console
```

## Service bootstrap
The steps taken to get WebHare running, and at what point various startup scripts
are invoked

- Docker launches `/opt/container/launch.sh`
- `wh console` gets exec-ed
  - Console/self build installations will generally invoke `wh console` directly (or indirectly through `wh (u)mic`
- `webhare console` gets exec-ed
  - boots the whmanager, compiler and dbserver
  - waits for compiler and dbserver to respond to their tcp/ip ports
  - starts the webserver, clusterservice `mod::system/scripts/internal/clusterservices.whscr`, startupscript `mod::system/scripts/internal/webhareservice-startup.whscr` and application runner `mod::system/scripts/internal/apprunner.whscr`
    - webhare-servicestartup does basic database initialization, if the database is empty (determined by checking if `system.webservers.id` exists)
    - it will then initiate the RestartReset procedure
      - RestartReset waits for the index to be up-to-date. This is where a WebHare with broken indices will stall until the
        rebuild is complete
    - the application runner will wait for the system configuration to become available and then executes the `<apprunnerconfig>` from all modules to gather the standalone services (i.e. services that don't depend on WebHare to be started) to run, including the `poststart` scripts and Consilio, if it's configured
  - waits for the startupscript to complete (if it fails, webhare startup is aborted)
  - launches scheduler
  - prints `Service started (online)`
    - note that it hasn't actually checked whether the last round of started processes are ready to go - it just assumes
      they will be online asap.
- The application runner executes the `<apprunnerconfig>` from all modules to gather any non-standalone services to run
  - Among other scripts, this starts the `executetasks` service
- executetasks and post-start will run in parallel:
  - poststart will execute UpdateSystemBackendSite, creating the 'WebHare backend' site
    - on completion, poststart will mark the 'poststartdone' phase as completed
  - executetasks will invoke `<runatstartup when="afterlaunch">` and `<task runatstartup=true>`, and start its normal queue
    processing

If webhare_testsuite is installed, poststart is responsible for setting up the test sites.

Use `wh waitfor poststartdone` if you need to wait for initialization tasks (and the creation of the test sites) to complete.

You can set `WEBHARE_DEBUGSTARTUP=1` in the environment to set the startup process into debugging mode

### The RestartReset procedure
See `restart_reset.whlib`.

Starts the various modules in the following groups:
- system
- the other builtinmodules (publisher, tollium, wrd, etc)
- the rest

For every module group applies their database definitions, and runs the following startupscripts in this order:
- `<runonce when="afterschemacreation">`
- `<runonce when="aftertablesbeforerights">`
- `<runonce when="aftertablecreation">`
- `<runonce when="afterregistryupdate">`

It will then proceed to recompile all site profiles, and wait for it to complete.

Broadcasts various events so everyone know there has been a softreset. This will trigger the webserver to
reload its configuration, the adhoccahe to flush, etc

### Debugging
If WebHare doesn't seem to fully start (eg 'Online' doesn't appear and the webhareservice-startup script doesn't
finish) you may be able to debug it by manually starting the debugmanager with `wh run mod::system/scripts/internal/debugmgr.whscr`
and opening the debugger in the webserver.
