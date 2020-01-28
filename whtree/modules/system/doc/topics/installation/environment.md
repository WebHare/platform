# Environment variables

List of environment variables understood by WebHare and/or the `wh` command

## Essential environment variables

## WEBHARE_DIR
WebHare installation directory. `$WEBHARE_DIR/bin/wh` must be the `wh` command. In docker, this is usually `/opt/wh/whtree`

### WEBHARE_DATAROOT
WebHare data root. If set, all datadirs are looked up relative to this path. In docker, this is usually `/opt/whdata`

`$WEBHARE_DATAROOT/.webhare-envsettings.sh`

If not set, WEBHARE_DATAROOT is set to '$WEBHARE_DIR/whdata'. If whdata is a symlink, `wh` will set WEBHARE_DATAROOT to
the expanded symlink. This allows you to specify a 'default' WebHare installation for a checked out soure tree.

### WEBHARE_BASEPORT
The base port number for various connections. If not set, assumed to be 13679.

### WEBHARE_DTAPSTAGE
Lock the DTAP stage. Must be one of 'production', 'acceptance', 'test' or 'development'. If not set, configurable in WebHare.

### WEBHARE_SERVERNAME
Override the server name

### WEBHARE_ISRESTORED
If non-zero, this WebHare is configured a 'restored' installation which may not run tasks with external effects.

### WEBHARE_CLI_USER
The user currently accessing the server. You should ensure this is set to the user executing commands for proper auditing.

### WEBHARE_IN_DOCKER
Set if we're running inside a docker environment, and not from a source installation

### WEBHARE_VERSION
Current semantic WebHare version number, eg 4.27.0

## Tweaks

### WEBHARE_CHECKEDOUT_TO
WebHare source directory, if you're running WebHare from source.

### WEBHARE_TEMP
Directory for temporary files. If not set, $WEBHARE_DATAROOT/tmp will be used.

### WEBHARE_MAINTENANCE_OFFSET
Maintenance window time offset, in minutes. All tasks with the 'maintenance' timezone will be offset this many minutes.

### WEBHARE_MODULEPATHS
Additional modulepath to search. Separate by colon (':'). In docker, this is usually `/opt/whmodules`

### WEBHARE_NOINSTALLATIONINFO
If set, no connectinfo will be written to the installationroot. This allows you to run a secondary WebHare installation
from the same tree without confusing your text editor.

### WEBHARE_CONFIGURL
If set, at every start/softreset a [server configuration file](serverconfig.md) will be downloaded from this location (either https:// or file:// url)
and applied. For https:// urls, some variables describing the current installation will added.

### WEBHARE_WH_HOOK
Points to a script that will be sourced by 'wh' and can filter any command passed to it

## Debugging/selftests

### WEBHARE_DEBUGCHROME
Set to 1 to enable the debugflag for the Chrome headless runner

### WEBHARE_DEBUGEVENTS
Set debuglevel for whfs/events.whlib. 1 = log actions, 3 = traces too

### WEBHARE_DEBUGSTARTUP
Set to 1 to enable debug for various potential startup issues

### WEBHARE_ALLOWEPHEMERAL
Set to 1 to allow the WebHare docker to run on ephemeral storage such as overlayfs.

## Testframework
`wh testdocker` and `wh testmodule` support some extra variables that are useful in CI environments

### TESTFW_SECRETSURL
A URL whose contents will be sourced by the tests and from which any environment variables starting
with `TESTFW_` or `WEBHARE_` will be set in the CI environment (except for `TESTFW_SECRETSURL` itself).

You need to make sure you fully control and trust whatever the URL points to as any shell code in the script it
points to may be executed by the test runner as well.

This variable can be setup as eg a [GitLab CI/CD environment variable](https://gitlab.com/help/ci/variables/README).
Please make sure you protect it !

# Tips and tricks

## Multiple installs
To easily run multiple installations in parallel, setup aliases in your .profile. Eg:
```
alias wh-moe2="WEBHARE_DATAROOT=$HOME/projects/whdata/moe2 WEBHARE_NOINSTALLATIONINFO=1 WEBHARE_BASEPORT=13300 wh"
```
You can then access or start this installation using eg `wh-moe2 console` or `wh-moe2 sql 'select * from system.ports'`

## Install-specific configuration
If you're running WebHare from source, you can create a file `$WEBHARE_DATAROOT/settings.sh` for installation specific
settings. Please note that this file is ignored by docker installations.

## Build-time variables
These variables are only used during the WebHare build proces or by 'from source' installations. They have no effect
on a running WebHare or on Docker versions

### WHUILD_NUMPROC
Number of processors to use (the `make -j` parameter). Estimated based on CPU cores and/or memory if not set.
