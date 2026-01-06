# Current vendored

## dragonbox
TODO why?

## fast_float
TODO why?

## libxml2
Vendored as submodule so we can embed it into emscripten builds more easily

To setup the project after checkout, run `vendor/setup-libxml2.sh` (although the makefile should do this for you)

## emsdk
To update the version to use:
- update the emsdk submodule
- update the version in platform.conf

# Adding vendors
## Submodules
- Use `git submodule add https://` - do not add git: urls
