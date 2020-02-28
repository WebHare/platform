# command: shell
# short: Launch a shell (similar to what Docker would do)

if [ -n "$WEBHARE_CHECKEDOUT_TO" ]; then
  export HOME=$WEBHARE_DATAROOT/root
fi

mkdir -p $WEBHARE_DATAROOT/root
exec bash --rcfile $WEBHARE_CHECKEDOUT_TO/addons/docker-build/dropins/etc/bash.bashrc -O histappend -O cmdhist
