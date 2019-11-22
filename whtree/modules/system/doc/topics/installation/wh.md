# The 'wh' tool
'wh' is the WebHare's Swiss army knife. It's a shortcut to everything you
would want to do on the command line when operating WebHare. The 'wh' tool
can also set up autocompletion for bash.

## Setup
Invoke `wh setupmyshell` to get the instructions to configure your shell to support
`whcd` and autocompletion. We recommend adding

```bash
eval `~/projects/webhare/whtree/bin/wh setupmyshell`
```

to your `~/.profile` (or `~/.bashrc` or `~/.bash_profile` if either exists). Update
the path to the `wh` tool as needed.

## Installation and development
`whcd <moduledir>[/subpath]` - Go straight to a module (sub)directory, eg `whcd mymodule/webdesigns/mydesign`

`wh getmodule group/module` - Download the specified module from gitlab.webhare.com and place it into $WHDATA/installedmodules

`wh softreset` - Rerun startup code (activate manually installed modules)

`wh softreset --sp` - Recompile site profiles

`wh cachereset [-p]` - Flush all adhoc caches. With the `-p` option, also clears the precalculated cache

## Managing a running webhare
`wh watchlog` - Monitor the most important logfiles (essentially 'tail -f')

`wh catlog [-f] <file>` - Simply cat a logfile, eg 'rpc'. Useful to build pipes

## Building and starting WebHare

`wh umic` - Updates the source tree and modules, Make Installs the code, starts Console mode

`wh mic` - Make Installs the code, starts Console mode

`wh console` - Launch WebHare in console mode (does not attempt to build or update first)

`wh make` builds WebHare.

`wh hstest <test>` - run a HareScript test (eg 'stringfunctions')

## Setting up multiple WebHare installations
If your WebHare was built from source you can use environment variables
to point the WebHare binaries to a different source folder. You will need
to set the WEBHARE_DATAROOT and WEBHARE_BASEPORT to different values for each
installation. We recommend setting WEBHARE_BASEPORT values at least '100' apart
for each installation starting at '14000'.

You can even
set up different wh 'aliases', each pointing to a different WebHare, for
example:

```bash
# A simple secondary installation:
alias wh-moe2="WEBHARE_DATAROOT=$HOME/projects/whdata/moe2 WEBHARE_BASEPORT=14000 wh"
wh-moe2 console # Launches it

# A completely separate source checkout:
alias wh-stable="WEBHARE_DIR=~/projects/wh_stable/whtree
                 WEBHARE_DATAROOT=$HOME/projects/whdata/wh-stable
                 WEBHARE_BASEPORT=14100 ~/projects/wh_stable/whtree/bin/wh"
wh-stable mic # Make, install, console
```

For more information see the [supported enviornment variables](environment.md).
Secondary installations may want to set `WEBHARE_ISRESTORED` or `WEBHARE_NOINSTALLATIONINFO`
to prevent them from connecting to external services or interfering with a running
primary installation.

If you're using the Docker version of WebHare you can just start it with
a different `/opt/whdata` mount to start a different WebHare.
