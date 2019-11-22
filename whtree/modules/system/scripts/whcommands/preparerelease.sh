source $WEBHARE_DIR/lib/wh-functions.sh

list_coremodules COREMODULES
if ! wh cleanuploadlibs --go $COREMODULES ; then
  echo "Loadlib cleanup failed"
  exit 1
fi
exit 0
