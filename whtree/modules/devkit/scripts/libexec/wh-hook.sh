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

  MAINBRANCH=master  # prep if we someday rename to 'main'

  if [ -d .git ]; then
    WEBHARE_BRANCH=$(git symbolic-ref --short HEAD 2> /dev/null)
    if [ "$WEBHARE_BRANCH" == "$MAINBRANCH" ] && # if you appear to be on the main branch
       ! git merge-base --is-ancestor $MAINBRANCH origin/$MAINBRANCH 2> /dev/null &&  # master is past origin/upstream
       ! git merge-base --is-ancestor $MAINBRANCH upstream/$MAINBRANCH 2> /dev/null; then
      die "It seems you have modified the '$MAINBRANCH' branch, but you can't commit there. Move your changes to a branch"
    fi

    if [ -z "$1" ] || [[ "webhare" =~ $1 ]]; then
      # Update automatically only when current branch is 'master' or 'release/*'
      if [[ "$WEBHARE_BRANCH" =~ ^master$|^release/ ]]; then
        echo "Update $WEBHARE_CHECKEDOUT_TO"
        if ! git pull --rebase && [ "$WEBHARE_IGNORE_WHUP_FAILURE" != "1" ]; then
          UPDATEERRORS="$UPDATEERRORS webhare"
          UPDATEFATAL=1
        fi
      elif [ "$WEBHARE_REBASE_EDGE_BRANCH" == "1" ] && [[ "$WEBHARE_BRANCH" =~ ^edge/ ]]; then
        # if the edge branche forked of a release branch, rebase on that, otherwise on origin/master
        local TESTBRANCHES=$(git show-ref | grep -o origin/release/.*)
        local EDGEPARENT=origin/master
        for TESTBRANCH in $TESTBRANCHES; do
          MERGEBASE=$(git merge-base $TESTBRANCH HEAD)
          if [ -n "$MERGEBASE" ] && ! git merge-base --is-ancestor $MERGEBASE origin/master; then
            EDGEPARENT="$TESTBRANCH"
            break;
          fi
        done
        echo "$(tput setaf 6)Rebasing branch $WEBHARE_BRANCH to origin branch $EDGEPARENT$(tput sgr0)"

        if ( ! git fetch || ! git rebase $EDGEPARENT ) && [ "$WEBHARE_IGNORE_WHUP_FAILURE" != "1" ]; then
          UPDATEERRORS="$UPDATEERRORS webhare"
          UPDATEFATAL=1
        fi
      fi

      # Install any missing submodules
      git -C "$P" submodule update --init --recursive
    fi

    # If your current branch isnt "master", update "master" with the origins hash. you're not supposed to manually commit to it anyway
    if [ "$WEBHARE_BRANCH" != "$MAINBRANCH" ] && [ -f ".git/refs/remotes/origin/$MAINBRANCH" ]; then
      git branch -f $MAINBRANCH "$(git rev-parse remotes/origin/$MAINBRANCH)"
    fi
  fi

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
    echo "=== Updating $WEBHARE_CHECKEDOUT_TO and modules ==="
    git_update_all
  else
    git_update_all "$1"
  fi
  exit 0
fi

if [ "$INSTR" == "umic" ]; then
  git_update_all
  INSTR="mic"
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
  if [ "$1" == "--fetch" ]; then
    FETCH=1
    shift
  fi

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

      # run git status once just to see if there's output (seems to be the easiest way to check for 'any changes')
      if [ -n "$(git -C "$P" status -uall -s)" ]; then
        echo "Uncomitted changes in ${MODNAME}:"
        git -C "$P" status -uall -s
        UNCOMMITEDCHANGES="$UNCOMMITEDCHANGES $MODNAME"
      fi

      if [ -n "$(git -C "$P" cherry --abbrev=7 -v "@{upstream}")" ]; then
        echo "Unpushed changes in ${MODNAME}:"
        git -C "$P" cherry --abbrev=7 -v "@{upstream}"
        UNPUSHEDCHANGES="$UNPUSHEDCHANGES $MODNAME"
      fi
    fi
  done

  #Note: missing space before $UN... are intentional!
  [ -n "$UNCOMMITEDCHANGES" ] && echo "Uncomitted:$UNCOMMITEDCHANGES"
  [ -n "$UNPUSHEDCHANGES" ] && echo "Unpushed:  $UNPUSHEDCHANGES"
  exit 0
fi
