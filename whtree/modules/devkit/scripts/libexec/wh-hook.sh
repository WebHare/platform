#!/bin/bash

if [ -z "$WEBHARE_DATAROOT" ]; then
  echo "WEBHARE_DATAROOT not configured!"
  exit 1
fi

# This file is sourced by `wh` if the devkit module is active
WEBHARE_DEVKIT_DATADIR="$WEBHARE_DATAROOT/storage/devkit/"

get_installable_moduledirs()
{
  local XDIRS

  if [ -d "$WEBHARE_DATAROOT"/installedmodules ]; then
    XDIRS=$WEBHARE_DATAROOT/installedmodules/*\ $WEBHARE_DATAROOT/installedmodules/*/*
  fi

  if [ -n "$WEBHARE_GITMODULES" -a -d "$WEBHARE_GITMODULES" ]; then
    XDIRS=$XDIRS\ $WEBHARE_GITMODULES/*\ $WEBHARE_GITMODULES/*/*
  fi

  if [ -n "$WEBHARE_GITPACKAGES" -a -d "$WEBHARE_GITPACKAGES" ]; then
    XDIRS=$XDIRS\ $WEBHARE_GITPACKAGES/*\ $WEBHARE_GITPACKAGES/*/*
  fi

  eval $1=\$XDIRS
  return 0
}

gather_repo_dirs()
{
  get_installable_moduledirs DIRS
  if [ -n "$WHRUNKIT_DATADIR" ]; then #Also process any installations added by 'runkit link-project'
    DIRS="${DIRS} ${WHRUNKIT_DATADIR}/_settings/projectlinks"/*
  fi
}

git_update_all()
{
  pushd $WEBHARE_CHECKEDOUT_TO >/dev/null
  UPDATEERRORS=""
  UPDATEFATAL=0

  gather_repo_dirs
  for P in $DIRS; do
    if [ -d "$P/.git/refs/remotes" ]; then
      MODNAME="${P##*/}"

      if [ -z "$1" ] || [[ "$MODNAME" =~ $1 ]]; then
        echo
        echo "Updating $MODNAME"

        # Update automatically only when current branch is 'master' or 'main'
        MODULE_BRANCH=$(git -C "$P" symbolic-ref --short HEAD 2> /dev/null)
        if [[ "$MODULE_BRANCH" =~ ^master$|^main$ ]]; then
          if ! git -C "$P" pull --rebase ; then
            UPDATEERRORS="$UPDATEERRORS $MODNAME"
            continue
          fi

          # Install any missing submodules
          git -C "$P" submodule update --init --recursive
        else
          echo "$(tput setaf 3)Not updating branch $MODULE_BRANCH$(tput sgr0)"
          UPDATEERRORS="$UPDATEERRORS $MODNAME"
        fi
      fi
    fi
  done
  popd >/dev/null

  if [ -n "$UPDATEERRORS" ]; then
    echo ""
    echo "$(tput setaf 3)The following packages were not updated:$UPDATEERRORS$(tput sgr0)"  #Note: missing space before $UPDATEERRORS is intentional!
  fi
  if [ "$UPDATEFATAL" == "1" ]; then
    die "$(tput setaf 1)This appears to be fatal, please fix!$(tput sgr0)"
  fi
}

devhooks__save_function() {
    local ORIG_FUNC=$(declare -f $1)
    local NEWNAME_FUNC="$2${ORIG_FUNC#$1}"
    eval "$NEWNAME_FUNC"
}

dev_monthly_prestart_cleanup()
{
  echo "Running monthly WebHare cleanup"

  if [ -d "$WEBHARE_DATAROOT/ephemeral/compilecache" ]; then
    mv "$WEBHARE_DATAROOT/ephemeral/compilecache" "$WEBHARE_DATAROOT/ephemeral/deleteme-cc"-$$-"$(date +%F%T)"
  fi

  rm -rf "$WEBHARE_DATAROOT/ephemeral/deleteme-"* >/dev/null 2>&1 &
}

devhooks__save_function setup_for_console devhooks__original_setup_for_console

setup_for_console()
{
  devhooks__original_setup_for_console

  # Remove pre-WH5.9 locations (both old and new dev module locations as it's move wasn't perfect)
  # This can be removed once we're convinced sufficient developers have invoked this
  [ -d "$WEBHARE_DATAROOT/dev" ] && rm -r "$WEBHARE_DATAROOT/dev"
  [ -d "$WEBHARE_DATAROOT/storage/dev" ] && rm -r "$WEBHARE_DATAROOT/storage/dev"

  # at this point WEBHARE_DATAROOT is even absolute!
  mkdir -p "$WEBHARE_DEVKIT_DATADIR" # create data directory for dev-only stuff, so developers can recognize what is part of core and what isn't

  # Do we need to run a monthly for-developers pre-start cleanup ?
  if [ -z "$WEBHARE_IN_DOCKER" ] && ! is_webhare_running ; then
    THISMONTH=$(date +%Y-%m)
    if [ "$THISMONTH" != "$( cat "$WEBHARE_DEVKIT_DATADIR/last-monthly-prestart-cleanup" 2>/dev/null )" ]; then
      echo "$THISMONTH" > "$WEBHARE_DEVKIT_DATADIR/last-monthly-prestart-cleanup"
      dev_monthly_prestart_cleanup
    fi
  fi
}

if [ "$INSTR" == "up" ] ; then
  if [ -z "$*" ]; then
    echo "=== Updating modules ==="
    git_update_all
  else
    git_update_all "$1"
  fi
  exit 0
fi

if [ "$INSTR" == "monthly-prestart-cleanup" ]; then
  check_webhare_not_running
  dev_monthly_prestart_cleanup
  exit
fi

if [ "$INSTR" == "status" ] || [ "$INSTR" == "st" ]; then
  echo "=== Status of $WEBHARE_CHECKEDOUT_TO ==="

  gather_repo_dirs
  UNCOMMITEDCHANGES=""
  UNPUSHEDCHANGES=""

  FETCH=
  VERBOSE=
  # parse args starting with '-'
  while [[ "$1" =~ ^- ]]; do
    case "$1" in
    (--fetch) FETCH=1 ;;
    (--verbose) VERBOSE=1 ;;
    (-v) VERBOSE=1 ;;
    (--) break;
    # shellcheck disable=SC2211
    (*)
      echo "Illegal option: $1"
      echo "Usage: wh dev status [--fetch] [--verbose] [<modulename-regex>]"
      exit 1 ;;
    esac
    shift
  done

  for P in "$WEBHARE_CHECKEDOUT_TO" $DIRS; do
    if [ -d "$P/.git/refs/remotes" ]; then
      MODNAME=${P##*/}

      if [ -n "$1" ]; then
        # shellcheck disable=SC2254 # we actually want glob matching here
        case "$MODNAME" in
        ($1) ;;
        (*) continue;;
        esac
      fi

      if [ -n "$FETCH" ]; then
        # silent fetch
        git -C "$P" fetch -q
      fi

      BRANCH=
      if [ -n "$VERBOSE" ]; then
        BRANCH=" (branch: $(git -C "$P" rev-parse --abbrev-ref HEAD))"
      fi

      # run git status once just to see if there's output (seems to be the easiest way to check for 'any changes')
      ANYCHANGE=
      if [ -n "$(git -C "$P" status -uall -s)" ]; then
        echo "Uncomitted changes in ${MODNAME}${BRANCH}:"
        git -C "$P" status -uall -s
        UNCOMMITEDCHANGES="$UNCOMMITEDCHANGES $MODNAME"
        ANYCHANGE=1
      fi

      if [ -n "$(git -C "$P" cherry --abbrev=7 -v "@{upstream}")" ]; then
        echo "Unpushed changes in ${MODNAME}${BRANCH}:"
        git -C "$P" cherry --abbrev=7 -v "@{upstream}"
        UNPUSHEDCHANGES="$UNPUSHEDCHANGES $MODNAME"
        ANYCHANGE=1
      fi
      if [ -z "$ANYCHANGE" ] && [ -n "$VERBOSE" ]; then
        echo "${MODNAME} is clean${BRANCH}"
      fi
    fi
  done

  #Note: missing space before $UN... are intentional!
  [ -n "$UNCOMMITEDCHANGES" ] && echo "Uncomitted:$UNCOMMITEDCHANGES"
  [ -n "$UNPUSHEDCHANGES" ] && echo "Unpushed:  $UNPUSHEDCHANGES"
  exit 0
fi
