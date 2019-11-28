# Building WebHare from source

## Getting started
Clone the repository (the examples assume we're extracting to `$HOME/projects`)

```bash
mkdir ~/projects
cd ~/projects
git clone git@gitlab.com:webhare/platform.git webhare
```

Now setup the `wh` tool by adding this to your `~/.profile` (or equivalent .bashrc of .bash_profile):
and relogging in or restarting your terminal session.

```bash
eval `~/projects/webhare/whtree/bin/wh setupmyshell`
```

See [wh](wh.md) for more information about the wh tool. All other documentation
will assume you've set this up and just refer to `wh` when they want you to
invoke the `webhare/whree/bin/wh` tool.

Make and install:
```bash
wh mic
```

The build process will attempt to estimate a proper number of parallel jobs to use (`make -j...`) but you can control the
number of processors used by `wh make` and `wh mic` by setting a `WHBUILD_NUMPROCS=nnn` variable eg `WHBUILD_NUMPROCS=4 wh mic`.

You should never set the number of build processors too high - the build process is highly parallel and can easily overwhelm a system.

Run `wh fixmodules` once to update NPM dependencies.

From this point, you should be able to use the [Getting started](https://www.webhare.dev/manuals/getting-started/) manual
to configure your WebHare - you can just leave out all the `docker exec webhare` parts.

## Getting Java to work
Some of the software used by WebHare (eg PDFBox for printer.whlib) requires Java. You will need to install that yourself.
Installation of any software mentioned here is at your own risk!

For OSX, you can install openjdk through Homebrew (see also: https://github.com/AdoptOpenJDK/homebrew-openjdk)

```bash
brew cask install adoptopenjdk
```

If you're getting an error that openjdk isn't notarized, you can go to System Preferences, Security & Privacy and click
"Allow anyway" on the General tab to enable it.


## Building for docker
```bash
wh builddocker
```

## Building instantclient/OCI
On macOS, just `brew install InstantClientTap/instantclient/instantclient-sdk` and remake

## Advanced build options
`WHBUILD_DEBUG=1` - Use whbuild.debug and build versions with extra debugging

To quickly run a specific blextest, eg 'string' (you really want this when editing stringmanip.cc):
```bash
BLEXTEST=string WHBUILD_NODEPS=1 wh make blex-test
```

## Troubleshooting common build failures
Try repeating the make command. If you only see 'error' or 'waiting for finished jobs' you may have to scroll up a bit to find the error (make often runs multiple tasks at the same time. if one task reported an error, it will finish the other running jobs so you may need to look for the error).

Before you try anything else, make sure you are up-to-date and try the fixbuild option and see if it fixes your issue:
```bash
# This executes various cleanup steps that usually fix ICU or NPM issues
wh fixbuild
```

#### "No rule to make target"
These errors are usually fixed by running `wh make clean-deps`

If tests are failing and you want to ignore this, run `NOTEST=1 wh mic`.

#### "TestLocalization: VersionTest yielded errors"
If 'got' is lower than 'expected', you need to update your ICU library. On OSX, a 'brew update' will update your brew definitions, after which it should carry out this update.

If 'got' is higher than 'expected', update or let us know.

#### "Library not loaded: /usr/local/opt/icu4c/lib/libicui18n.55.dylib Referenced from: /wh/whbuild/blex/tests/dynamic.dylib"
This error, and similar errors, may be caused by updating libraries (especially when the error refers to an older version of the library, like icu v55 above). Try `wh make clean-libs` to remove all compiled libraries

#### lib/hsm_wh_icu.dylib Error 1
There were probably errors building the icu provider, and the autodependency checking tends to be bad at picking up icu recompiles, at least on OSX.

Run `wh make clean-icu-provider` to specifically reset the ICU module. If ICU issues persist, consider downgrading to an earlier version. On OSX with brew:

```bash
# Show available versions
brew list --versions icu4c
# this will return something like: icu4c 59.1_1 60.2

# Pick an earlier version
brew switch icu4c 59.1_1
```

#### libssh2: Unknown `--is-lightweight` option
This is usually caused by broken or out-of-date command line tools on OSX.

Update Xcode, start Xcode and make sure you accepted the EULA and it got a chance to download updated command line tools.

After this, you'll probably have to go through a 'wh fixbuild'.

#### compiler: `error: invalid value 'c++17' in '-std=c++17'`
Ensure your compiler (gcc orclang) is up-to-date.

On macOS, check that the OS, XCode and XCode's developer tools are up-to-date.

#### If you're about to give up:
```bash
# Discard build directory and resetup the build proces
rm -rf ~/projects/whbuild
wh mic
```
