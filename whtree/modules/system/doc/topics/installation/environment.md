# Environment variables

List of environment variables understood by WebHare and/or the `wh` command

## Essential environment variables

### WEBHARE_DIR
WebHare installation directory. `$WEBHARE_DIR/bin/wh` must be the `wh` command. In docker, this is usually `/opt/wh/whtree`

### WEBHARE_DATAROOT
WebHare data root. If set, all datadirs are looked up relative to this path. In docker, this is usually `/opt/whdata`

If not set, WEBHARE_DATAROOT is set to '$WEBHARE_DIR/whdata'. If whdata is a symlink, `wh` will set WEBHARE_DATAROOT to
the expanded symlink. This allows you to specify a 'default' WebHare installation for a checked out soure tree.

### WEBHARE_BASEPORT
The base port number for various connections. If not set, assumed to be 13679. The following ports are offset from this number:
- `+0` (13679) - Rescue port. Serves an unencrypted webinterface even if the webserver configuration cannot be processed
- `+5` (13684) - Trusted port - we trust `X-Forwarded-*` headers
- `+6` (13685) - OpenSearch
- `+7` (13686) - Used to connnect to chrome headless runner
- `+8` (13687) - Reserved for OpenSearch dashboard (WebHare runkit)

### WEBHARE_POSTGRES_OPENPORT
If set allows TCP access to PostgreSQL on the port 'baseport + 8', usually 13687. Automatically enabled when running as a container.

### WEBHARE_DTAPSTAGE
Lock the DTAP stage. Must be one of 'production', 'acceptance', 'test' or 'development'. If not set, configurable in WebHare.

### WEBHARE_SERVERNAME
Override the server name

### WEBHARE_POSTSTARTSCRIPT
Path to a shell script to execute near the end of the post-start script.

### WEBHARE_ISRESTORED
If set, this WebHare is configured a 'restored' installation which may not run tasks with external effects. It can be set
to a short explanation about the restore (eg a date).

If `WEBHARE_DATAROOT/webhare.restoremode` exists, WebHare will read the contents of this file and place it into the
`WEBHARE_ISRESTORED` environment variable. You can verify this behavior by runnning `wh dirs` and checking the output.

### WEBHARE_CLI_USER
The user currently accessing the server. You should ensure this is set to the user executing commands for proper auditing.

### WEBHARE_IN_CONTAINER
Set if we're running inside a container environment, and not from a source installation. Added in WebHare 5.9

### WEBHARE_IN_DOCKER
Old name for `WEBHARE_IN_CONTAINER`

### WEBHARE_VERSION
Current semantic WebHare version number, eg 4.27.0

### WEBHARE_SERVICEMANAGERID
Unique ID intended to be inherited by all children of a service manager. This can also be used to track orphaned processes, eg
on macOS: `ps ewwax|grep ' WEBHARE_SERVICEMANAGERID=' | sed -r 's/^([^.]+).*$/\1/; s/^[^0-9]*([0-9]+).*$/\1/'`

### WEBHARE_PLATFORM
Our build/run platform. `linux` or `darwin`

### WEBHARE_NODE_BINARY
Which process to invoke for 'node' (needed sometimes to lock in the proper version)

### WEBHARE_NODE_MAJOR
Major nodejs version for WebHare to use

## Tweaks

### WEBHARE_CHECKEDOUT_TO
WebHare source directory, if you're running WebHare from source.

### WEBHARE_NODE_OPTIONS
Options to pass to `node` (for options not acceptd by `$NODE_OPTIONS`)

### WEBHARE_TEMP
Directory for temporary files. If not set, $WEBHARE_DATAROOT/tmp will be used.

### WEBHARE_MAINTENANCE_OFFSET
Maintenance window time offset, in minutes. All tasks with the 'maintenance' timezone will be offset this many minutes.

### WEBHARE_MODULEPATHS
Additional modulepath to search. Separate by colon (':'). In a containers this is set `/opt/whmodules`

### WEBHARE_NOINSTALLATIONINFO
If set, no connectinfo will be written to the installationroot. This allows you to run a secondary WebHare installation
from the same tree without confusing your text editor.

## WEBHARE_DEFAULT_IMAGE_FORMAT
Override the default image format. Should be 'keep', 'image/webp' or 'image/avif'. This is a temporary environment variable
to allow CI against different image format settings

### WEBHARE_PGBIN
Override the PostgreSQL binaries directory

### WEBHARE_PGCONFIGFILE
Override the configuration file passed to PostgreSQL

### WEBHARE_WH_HOOK
Points to a script that will be sourced by 'wh' and can filter any command passed to it

### WEBHARE_WEBSERVER
If set to `node` this will enable the experimental JS webserver.

### WEBHARE_NO_SOURCEMAPS
If set WebHare will not pass `--enable-source-maps` to NodeJS

## WEBHARE_NO_CONFIG
Set to 1 to not read or use the WebHare config file. This is needed to bootstrap WebHare as many commands rely on the configuration existing.

## Networking
Changing the bindings of internal ports gives you more flexibility to route internal WebHare traffic or to access ports
for debugging but may have serious repercussions for security. Be very careful when opening these ports and make sure
they are properly firewalled from external traffic

### WEBHARE_SECUREPORT_BINDIP
Set the IP address binding for the secure/trusted port (usually 13684). If not set it defaults to localhost. This port is
intended for the nginx reverse proxy and allows connections to fake their source port, IP and protocol.

### WEBHARE_RESCUEPORT_BINDIP
Set the IP address binding for the rescue port (usually 13679). If not set it defaults to localhost. The rescueport hosts
an insecure WebHare backend interface. (Pre 5.02, WebHare would us 13688 as its rescue port because 13679 was reserved
for the database server)

### WEBHARE_OPENSEARCH_BINDHOST
Set the host (or IP) for the builtin OpenSearch, if enabled. If not set it defaults to 127.0.0.1

## Debugging/selftests

### WEBHARE_DEBUG
Set debug flags, eg `WEBHARE_DEBUG=que` to globally enable logging of queue actions. See `wh debug listflags` for an
up to date listof debugflags suppoted by your local installation. To set multiple flags separate them by commas (`,`).

You can also set custom debug flags for your own modules and check them using %IsDebugTagEnabled. These should be prefixed
with your modulename and a double colon (`:`) and documented in your moduledefinition file.

See also [profiling](https://www.webhare.dev/reference/internals/profiling) for profiling flags

### WEBHARE_DEBUG_SERVICE
Signals a started service process that it's being invoked by `wh service debug`

### WEBHARE_DEBUGCHROME
Set to 1 to enable the debugflag for the Chrome headless runner

### RUNKIT_TARGET_SLUG
Override the hostname in the PS1 prompt. Usually set by `runkit wh shell` with container information

### TESTFW_FORCECOLOR
If set, enables ANSI color within tests (using the test framework) even if no console is available.

## Testframework
`wh testcontainer` supports some extra variables that are useful in CI environments

### TESTSECRET_SECRETSURL
A URL whose contents will be sourced by the tests and from which any environment variables starting
with `TESTFW_` or `TESTSECRET_` will be passed on to the CI environment (except for `TESTSECRET_SECRETSURL` itself).
The `WEBHARE_DEBUG` is also passed to the CI environment. Any environment variables whose name starts with `TESTFW_WEBHARE_`
or `TESTSECRET_WEBHARE_` will be passed as `WEBHARE_` to the CI environment. CI scripts should access these variables using
%GetTestSecret

Keep in mind that the buildscripts will list all the set variables and their contexts in their output (the contents of
`TESTSECRET_` variables are replaced with `xxxxxx` here so you can still see whether or not they were properly set)

You need to make sure you fully control and trust whatever the URL points to as any shell code in the script it
points to may be executed by the test runner as well.

This variable can be setup as eg a [GitLab CI/CD environment variable](https://gitlab.com/help/ci/variables/README).
Please make sure you protect it !

### TESTFW_TWOHARES
If set, two separate WebHares are running. This enables some additional tests

### WEBHARE_CI
The `WEBHARE_CI` variable is set by testcontainer/testmodule to indicate that the current installation is started by CI

### WEBHARE_CI_MODULE
The `WEBHARE_CI_MODULE` variable contains the name of the module being tested by CI. (added in 5.02)

### WEBHARE_ENABLE_DEVKIT
The devkit module is normally only enabled in source installations (see `enableDevKit()`). This flag enable the devkit module even if running in a container environment.
