source $WEBHARE_DIR/lib/wh-functions.sh

TIMEOUT=""

while true; do
  if [ "$1" == "--timeout" ]; then
    TIMEOUT="$2"
    REMAINING=$(( $TIMEOUT * 5 )) # multiply by 5 as we wait .2 second intervals
    shift
    shift
  elif [[ $1 =~ ^- ]]; then
    echo "Illegal option '$1'"
    exit 1
  else
    break
  fi
done

if [ "$1" != "poststart" -a "$1" != "poststartdone" -a "$1" != "__timeouttest" ]; then
  die "Only poststart and poststartdone are supported"
fi

WAITFOR="$WEBHARE_DATAROOT/ephemeral/system.servicestate/$1"
while true; do
  if [ -f "$WAITFOR" ]; then
    exit 0
  fi
  if [ -n "$REMAINING" ]; then
    REMAINING=$(( $REMAINING - 1))
    if [ "$REMAINING" == "0" ]; then
      echo Timeout waiting for $1 after $TIMEOUT seconds
      exit 250
    fi
  fi
  sleep .2
done
