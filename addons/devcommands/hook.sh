devhooks__save_function() {
    local ORIG_FUNC=$(declare -f $1)
    local NEWNAME_FUNC="$2${ORIG_FUNC#$1}"
    eval "$NEWNAME_FUNC"
}

devhooks__save_function setup_for_console devhooks__original_setup_for_console

setup_for_console()
{
  devhooks__original_setup_for_console

  # at this point WEBHARE_DATAROOT is even absolute!
  mkdir -p "$WEBHARE_DATAROOT/dev" # create data directory for dev-only stuff, so developers can recognize what is part of core and what isn't

  # Do we need to run a monthly for-developers pre-start cleanup ?
  if [ -z "$WEBHARE_IN_DOCKER" ]; then
    THISMONTH=$(date +%Y-%m)
    if [ "$THISMONTH" != "$( cat "$WEBHARE_DATAROOT/dev/last-monthly-prestart-cleanup" 2>/dev/null )" ]; then
      echo $THISMONTH > "$WEBHARE_DATAROOT/dev/last-monthly-prestart-cleanup"
      "$WEBHARE_CHECKEDOUT_TO"/addons/devcommands/monthly-prestart-cleanup.sh
    fi
  fi
}

if [ "$INSTR" == "monthly-prestart-cleanup" ]; then
  check_webhare_not_running
  "$WEBHARE_CHECKEDOUT_TO"/addons/devcommands/monthly-prestart-cleanup.sh
  exit
fi
