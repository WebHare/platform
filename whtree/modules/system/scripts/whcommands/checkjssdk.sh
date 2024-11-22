#!/bin/bash

# We could have tried to integrate jssdk/ with existing Harescript-based validatora
# but that would require them understanding jssdk/ as a resource and doesn't seem worth the trouble

ESLINTOPTIONS=""
TSFMTOPTIONS="--verify"
RETVAL=0
FIX=0
if [ "$1" == "--fix" ]; then
  ESLINTOPTIONS="--fix"
  TSFMTOPTIONS="--replace"
  FIX=1
fi

cd "$WEBHARE_DIR" || exit 1

if ! node_modules/.bin/eslint $ESLINTOPTIONS --config eslint.config.mjs jssdk ; then
  echo "ERR! FATAL: jssdk does not pass eslint"
  RETVAL=1
fi

if ! node_modules/.bin/tsfmt $TSFMTOPTIONS --no-tslint --no-editorconfig --no-vscode --useTsfmt tsfmt.json \
       $(find jssdk  -not -regex '.*/vendor/.*'  -name "*.ts" -or -name "*.tsx") ; then
  echo "ERR! FATAL: jssdk does not pass tsfmt --verify"
  RETVAL=1
fi

[ "$RETVAL" != "0" ] && [ "$FIX" == "0" ] && echo "Use \`wh checkjssdk --fix\` to automatically fix as much as possible"
exit $RETVAL
