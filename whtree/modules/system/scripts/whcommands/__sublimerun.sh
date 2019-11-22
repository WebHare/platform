#!/bin/bash
source $WEBHARE_DIR/lib/wh-functions.sh

# __sublimerun compensates for the 'lingering process' bug in sublime
# and it also allows us a chance to implement 'default' arguments for scripts

if [ -f "$HOME/.webhare-sublime-currentpid" ]; then
  CURRENTPID=`cat $HOME/.webhare-sublime-currentpid`
  if [ "`ps -o lstart= $CURRENTPID`" == "`cat $HOME/.webhare-sublime-currentpidlstart`" ]; then
    kill -9 $CURRENTPID
    echo "Killed lingering script with pid $CURRENTPID"
  fi
fi

SCRIPT="$1"
shift

if [ -z "$__DID_AUTO_ARGUMENTS" -a -f "${SCRIPT%.*}.args" ]; then
  export __DID_AUTO_ARGUMENTS=1
  # reexec with our command line so hopefully they get reprocessed?
  ARGS="`cat ${SCRIPT%.*}.args`"
  exec /bin/bash -c "$WEBHARE_DIR/modules/system/scripts/whcommands/__sublimerun.sh $SCRIPT $@ $ARGS"
  exit 255
fi

# Record current pid so we can kill it if needed
echo $$ > "$HOME/.webhare-sublime-currentpid"
ps -o lstart= $$ > "$HOME/.webhare-sublime-currentpidlstart"

if [ "${SCRIPT: -3}" == ".es" -o "${SCRIPT: -3}" == ".js" ]; then
  setup_node
  BASE_DIR=$WEBHARE_DIR/node_modules
  if [ "$1" == "--debug" ]; then
    NODEOPTIONS=--debug
    shift
  fi
  if [ "$1" == "--inspect" ]; then
    NODEOPTIONS=--inspect
    shift
  fi

  exec node $NODEOPTIONS "$SCRIPT" "$@"
else
  exec_runscript --workerthreads 4 "$SCRIPT" "$@"
fi

exit 1
