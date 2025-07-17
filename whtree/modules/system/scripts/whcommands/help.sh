#!/bin/bash
# syntax: [module]
# short: Lists help for all builtin commands

source "$WEBHARE_DIR/lib/wh-functions.sh"

FORMODULE="$1"

right_pad()
{
  PAD="                                       "
  if [ "${#1}" -gt "${#PAD}" ]; then
    PAD=""
  else
    PAD="${PAD:${#1}}"
  fi
  echo "$1$PAD"
}


show_commandfile_help() # instr filename
{
  local SHORT
  SYNTAX="$(grep -iE "^(#|//) *syntax: " "$2")"
  SHORT="$(grep -iE "^(#|//)( *short| @webhare/cli): " "$2")"

  SYNTAX="${SYNTAX#*: }"
  SHORT="${SHORT#*: }"
  if [ -z "$SHORT" ]; then #If not specified, assume it's intended as an internal/undocumented command
    return
  fi

  if [ -z "$SYNTAX" ]; then
    # If no SYNTAX, fallback to COMMAND - this includes the ccommand itself though and we prefer more flexibility than that..
    echo "$(right_pad "$1") $SHORT"
  else
    echo "$(right_pad "$1 $SYNTAX") $SHORT"
  fi
}

show_module_commands() # modulename
{
  getmoduledir MODULEDIR "$1"
  SCRIPTDIR="${MODULEDIR}scripts/whcommands/"
  for SCRIPTPATH in "${SCRIPTDIR}"*.whscr "${SCRIPTDIR}"*.sh "${SCRIPTDIR}"*.ts; do
    if [ -f "$SCRIPTPATH" ]; then
      FILENAME="${SCRIPTPATH##*/}"
      INSTR="$MODULE:${FILENAME%.*}"
      show_commandfile_help "$INSTR" "$SCRIPTPATH"
    fi
  done
}

[ -z "$FORMODULE" ] && cat "$WEBHARE_DIR/modules/system/doc/wh.txt"

if [ -z "$FORMODULE" ] || [ "$FORMODULE" == "platform" ]; then
  for SCRIPTPATH in '%s\n' "$WEBHARE_DIR/modules/platform/cli-commands/"*.ts; do
    if [ -f "$SCRIPTPATH" ]; then
      FILENAME="${SCRIPTPATH##*/}"
      INSTR="${FILENAME%.*}"
      show_commandfile_help "$INSTR" "$SCRIPTPATH"
    fi
  done
fi


if [ -z "$FORMODULE" ] || [ "$FORMODULE" == "system" ]; then
  for SCRIPTDIR in $WEBHARE_DIR/modules/system/scripts/whcommands/; do
    for SCRIPTPATH in '%s\n' "${SCRIPTDIR}"*.whscr "${SCRIPTDIR}"*.sh "${SCRIPTDIR}"*.ts; do
      if [ -f "$SCRIPTPATH" ]; then
        FILENAME="${SCRIPTPATH##*/}"
        INSTR="${FILENAME%.*}"
        show_commandfile_help "$INSTR" "$SCRIPTPATH"
      fi
    done
  done
fi

if [ -x "$WEBHARE_DIR/bin/runscript" ]; then
  for MODULE in $( cd "$WEBHARE_DATAROOT/config/mod" && echo *); do
    if [ "$MODULE" = "system" ]; then
      continue
    fi
    if [ "$FORMODULE" != "" ] && [ "$MODULE" != "$FORMODULE" ]; then
      continue
    fi
    show_module_commands "$MODULE"
  done
else
  echo "Not querying modules for commands or help, because runscript isn't built yet"
fi
