#!/bin/bash
source "$WEBHARE_DIR/lib/wh-functions.sh"

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
  local COMMAND SHORT
  COMMAND=$(grep -ie "^\(#\|///\?\) *command: " $2)
  SHORT=$(grep -ie "^\(#\|///\?\) *short: " $2)

  COMMAND=${COMMAND#*: }
  SHORT=${SHORT#*: }
  if [ -z "$SHORT" ]; then
    return
  fi

  if [ -z "$COMMAND" ]; then
    COMMAND="$1"
  fi
  echo "$(right_pad "$COMMAND") $SHORT"
}

cat "$WEBHARE_DIR/modules/system/doc/wh.txt"

SCRIPTDIRS="$WEBHARE_DIR/modules/system/scripts/whcommands/"

for SCRIPTDIR in $SCRIPTDIRS; do
  for SCRIPTPATH in '%s\n' "${SCRIPTDIR}"*.whscr "${SCRIPTDIR}"*.sh; do
    if [ -f $SCRIPTPATH ]; then
      FILENAME="${SCRIPTPATH##*/}"
      INSTR="${FILENAME%.*}"
      show_commandfile_help "$INSTR" "$SCRIPTPATH"
    fi
  done
done

INSTR=help
if [ -x "$WEBHARE_DIR/bin/runscript" ]; then
  loadshellconfig
  for MODULE in $WEBHARE_CFG_MODULES; do
    if [ "$MODULE" != "system" ]; then
      getmoduledir MODULEDIR $MODULE
      SCRIPTDIR="${MODULEDIR}scripts/whcommands/"
      for SCRIPTPATH in "${SCRIPTDIR}"*.whscr "${SCRIPTDIR}"*.sh; do
        if [ -f $SCRIPTPATH ]; then
          FILENAME="${SCRIPTPATH##*/}"
          INSTR="$MODULE:${FILENAME%.*}"
          show_commandfile_help "$INSTR" "$SCRIPTPATH"
        fi
      done
    fi
  done
else
  echo "Not querying modules for commands or help, because runscript isn't built yet"
fi
