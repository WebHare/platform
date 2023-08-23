# WebHare bootstrap

To get from a source tree to a running WebHare the installation needs to be 'finalized' and 'bootstrapped'. Finalization
adds to the 'source' directory, bootstrap sets up the 'data' directory. Both are necessary for the TypeScript and HareScript
engines to function, and after bootstrap `wh console` should work and the various core services (ue webserver, database,
HareScript compiler, whmanager/bridge) should be able to start.

Database initialization and (module) upgrade scripts are generally not considered parts of the bootstrapping process as
they are started after or in parallel with the core services.

The Docker build process runs a 'shrinkwrap' step which gather artifacts from the bootstrap process (compilecache) into the
build image to speed up the actual bootstrap when starting WebHare.

## Finalizing WebHare
See `whtree/modules/platform/scripts/bootstrap/finalize-webhare.sh` for the implementation

### Installing NPM packages
Finalization installs the packages in `whtree/package.json` (outside the built-in modules)

### Bootstrapping TypeScript
WebHare uses Node.js for JavaScript execution, but Node does not support TypeScript out of the box. We plug in a resolve
to add on-demand TypeScript compilation using esbuild. @webhare/ts-esbuild-runner provides this plugin. The plugin itself
is build by manually invoking esbuild to create a JavaScript version for later use.

## Bootstrap

### Preparing the data directory
`whtree/modules/platform/scripts/bootstrap/prepare-whdata.sh` sets up the `$WEBHARE_DATAROOT` and some subfolders and symlinks 
that Node will need to resolve `@webhare/`, `@mod-xxx/` and `wh:` imports. After this step `wh run` should be able to run 
TypeScript files.
### config.json
`platform/scripts/bootstrap/whdata.sh` also sets up the configuration file.

`$WEBHARE_DATAROOT/storage/system/generated/config/config.json` contains the layout of the module directories and other
central configuration that JavaScript and C++ processes expect to have available synchronously at startup. An initial version
is generated without consulting the database and will be updated later as needed.

Since WebHare 5.4 the C++ parts of WebHare (including the native HareScript engine still responsible for bringing up the
database, webserver and backend) will not be able to function without this configuration file.

### Service bootstrap
The steps taken to get WebHare running, and at what point various startup scripts
are invoked

- Docker launches `/opt/container/launch.sh`
- `wh console` gets exec-ed
  - Console/self build installations will generally invoke `wh console` directly (or indirectly through `wh (u)mic`)
- `webhare console` gets exec-ed
  - (source only) builds the platform-helpers library
  - updates the stored configuration file (in whdata/storage/system/generated/config/config.json)
  - boots the whmanager, compiler and dbserver
  - waits for compiler to respond to its tcp/ip port
  - starts the webserver, clusterservice `mod::system/scripts/internal/clusterservices.whscr`, startupscript `mod::system/scripts/internal/webhareservice-startup.whscr` and application runner `mod::system/scripts/internal/apprunner.whscr`
    - webhare-servicestartup does basic database initialization, if the database is empty (determined by checking if `system.webservers.id` exists)
    - it will then initiate the RestartReset procedure
      - after the database is ready, the configuration file will be fully updated (also updating content read from the database)
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

You can set `WEBHARE_DEBUG=startup` in the environment to set the startup process into debugging mode

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

It will then proceed to recompile all site profiles and apply WRD schema updates. The schema update and siteprofile compilation
tasks will run in parallel. It will wait for both to complete.

Broadcasts various events so everyone know there has been a softreset. This will trigger the webserver to
reload its configuration, the adhoccache to flush, etc

### Debugging
If WebHare doesn't seem to fully start (eg 'Online' doesn't appear and the webhareservice-startup script doesn't
finish) you may be able to debug it by manually starting the debugmanager with `wh run mod::system/scripts/internal/debugmgr.whscr`
and opening the debugger in the webserver.
