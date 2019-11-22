#!/bin/bash

source `dirname $0`/functions.sh

BASEDIR=$(get_absolute_path $(dirname $0)/../..)
TESTSUITEDIR=${MODULESDIR}/webhare_testsuite
DOCKERARGS=
TERSE=--terse
ENTERSHELL=
STOPONFAIL=
RUNTESTARGS=
PORTMAPPING=
JSTESTBROWSER=
SELENIUMHOST=
EXPLICITPORT=
COVERAGE=
ADDMODULES=
ISMODULETEST=
TESTFAIL=0
ARTIFACTS=
NOPULL=0
TESTPOSTGRESQL=

while true; do
 if [ "$1" == "--cpuset-cpus" ]; then
    DOCKERARGS="$DOCKERARGS $1=$2"
    shift
    shift
  elif [ "$1" == "--cpu" ]; then
    DOCKERARGS="$DOCKERARGS --cpu-quota=${2}000"
    shift
    shift
  elif [ "$1" == "--coverage" ]; then
    shift
    COVERAGE=1
    PROFILE=
  elif [ "$1" == "--profile" ]; then
    shift
    PROFILE=1
    COVERAGE=
  elif [ "$1" == "--nopull" ]; then
    shift
    NOPULL=1
  elif [ "$1" == "--noterse" ]; then
    TERSE=
    shift
  elif [ "$1" == "--nocleanup" ]; then
    NOCLEANUP=1
    shift
  elif [ "$1" == "--sh" ]; then
    ENTERSHELL=1
    shift
  elif [ "$1" == "--stoponfail" ]; then
    STOPONFAIL="--type=break"
    shift
  elif [[ "$1" =~ ^--tag= ]] || [ "$1" == "--loop" ] || [ "$1" == "-d" ]; then
    RUNTESTARGS="$RUNTESTARGS $1"
    shift
  elif [ "$1" == "--port" ]; then
    shift
    DOCKERARGS="$DOCKERARGS -p $1:8000"
    EXPLICITPORT=1
    shift
  elif [ "$1" == "--generatexmltests" ]; then
    GENERATEXMLTESTS=1
    shift
  elif [ "$1" == "--jstests" ]; then
    shift
    JSTESTBROWSER=$1
    shift
  elif [ "$1" == "--seleniumhost" ]; then
    shift
    SELENIUMHOST=$1
    shift
  elif [ "$1" == "--skips" ]; then
    shift
    SKIPS="$SKIPS $1"
    shift
  elif [ "$1" == "--addmodule" -o "$1" == "-a" ]; then
    shift
    ADDMODULES="$ADDMODULES $1"
    shift
  elif [ "$1" == "--webhareimage" -o "$1" == "-w" ]; then
    shift
    WEBHAREIMAGE="$1"
    shift
  elif [ "$1" == "--output" -o "$1" == "-o" ]; then
    shift
    ARTIFACTS=$(get_absolute_path "$1")
    shift
  elif [ "$1" == "-m" ]; then
    ISMODULETEST=1
    shift
  elif [ "$1" == "--dbserver" ]; then
    TESTPOSTGRESQL=0
    shift
  elif [ "$1" == "--postgres" ] || [ "$1" == "--postgresql" ] ; then
    TESTPOSTGRESQL=1
    shift
  elif [[ $1 =~ ^- ]]; then
    echo "Illegal option '$1'"
    exit 1
  else
    break
  fi
done

if [ -z "$TESTPOSTGRESQL" ] && [ "$WEBHARE_INITIALDB" == "postgresql" ] || [ "${CI_COMMIT_REF_NAME:0:11}" == "edge/pgsql-" ] || [ "${CI_COMMIT_REF_NAME:0:14}" == "feature/pgsql-" ] ; then
  TESTPOSTGRESQL=1
fi

if [ "$TESTPOSTGRESQL" == "1" ]; then
  DOCKERARGS="$DOCKERARGS -e WEBHARE_INITIALDB=postgresql"
fi

if [ -n "$ISMODULETEST" ]; then
  if [ -n "$CI_PROJECT_DIR" ]; then
    TESTINGMODULE="$CI_PROJECT_DIR"
  else
    TESTINGMODULE="${1%%.*}"
    shift
    if [ -z "$TESTINGMODULE" ]; then
      echo "Please specify a testmodule to run"
      exit 1
    fi
  fi
fi

TESTLIST="$@"
BUILDDIR="$PWD"
cd `dirname $0`

if [ -n "$TESTFW_SECRETSURL" ]; then
  DOWNLOADPATH=`mktemp`
  if ! curl --fail -o $DOWNLOADPATH "$TESTFW_SECRETSURL"; then
    echo "Cannot retrieve secrets"
    exit 1
  fi
  source "$DOWNLOADPATH"
  rm "$DOWNLOADPATH"
  unset TESTFW_SECRETSURL
fi

if [ -n "$ISMODULETEST" -a -z "$WEBHAREIMAGE" ]; then
  WEBHAREIMAGE=head
fi

if [ "$WEBHAREIMAGE" == "head" -o "$WEBHAREIMAGE" == "stable" ]; then
  WEBHAREIMAGE=`curl -s https://build.webhare.org/ci/dockerimage-$WEBHAREIMAGE.txt`
  if [ -z "$WEBHAREIMAGE" ]; then
    echo "Cannot retrieve actual image to use for image alias $WEBHAREIMAGE"
    exit 1
  fi
  WEBHAREIMAGE="$WEBHAREIMAGE"
elif [ "$WEBHAREIMAGE" == "local" ]; then
  WEBHAREIMAGE="webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}"
  NOPULL=1
fi

if [ -z "$WEBHAREIMAGE" ]; then
  get_finaltag
  WEBHAREIMAGE=$BUILD_IMAGE
  if [ "$WEBHAREIMAGE" == "webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}" ]; then
    NOPULL=1
  fi
fi

if [[ "$WEBHAREIMAGE" = "webhare/webhare-core:4.18" ]]; then
  WEBHAREIMAGE=webhare/webhare-core:4.18-withts
  RUNTESTARGS="$RUNTESTARGS --allownomatch"
fi

if [ "$DOCKERSUDO" == "1" ]; then
  SUDO=sudo
else
  SUDO=
fi

if [ "$NOPULL" != "1" ]; then
  echo "`date` Pulling image $WEBHAREIMAGE"
  if ! $SUDO docker pull "$WEBHAREIMAGE" ; then
    echo "Failed to pull image"
    exit 1
  fi
fi

# List our configuration
echo "Test environment variables:"
# not listing CI_, lots of noise and usually not really relevant anymore at this point. Just look at the BUILD setup if you want these
set | egrep '^(TESTFW_|WEBHARE_DEBUG|DOCKERARGS=)' | sort

# Cleanup
TEMPBUILDROOT=
CONTAINER=
function cleanup()
{
  if [ -n "$CONTAINER" ]; then
    if [ -z "$NOCLEANUP" ]; then
      echo "`date` Cleanup: stop container $CONTAINER"
      $SUDO docker stop $CONTAINER
      # [ "$TESTFAIL" == "0" ] || $SUDO docker logs $CONTAINER
      $SUDO docker rm $CONTAINER
    else
      echo "Not cleaning up, so don't forget to: $SUDO docker stop $CONTAINER"
    fi
  fi
  if [ -n "$TEMPBUILDROOT" ]; then
    if [ -z "$NOCLEANUP" ]; then
      echo "`date` Cleanup: remove buildroot $TEMPBUILDROOT"
      rm -rf -- "$TEMPBUILDROOT"
    else
      echo "Not cleaning up, so don't forget to: rm -rf -- $TEMPBUILDROOT"
    fi
  fi
}
trap cleanup EXIT

if [ -z "$DOCKERBUILDFOLDER" ]; then
  DOCKERBUILDFOLDER="/tmp/"
fi

# Independent tempdir
TEMPBUILDROOT=$DOCKERBUILDFOLDER/$$$(date | (md5 2>/dev/null || md5sum) | head -c8)

if [ -n "$ISMODULETEST" ]; then
  TESTINGMODULEDIR="$TESTINGMODULE"
  if [ ! -d "$TESTINGMODULEDIR" ]; then
    TESTINGMODULEDIR="`${PWD}/../../whtree/bin/wh getmoduledir $TESTINGMODULE`"
    if [ ! -d "$TESTINGMODULEDIR" ]; then
      echo "Cannot find module $TESTINGMODULE - we require the base module to be checked out so we can extract dependency info"
      echo "Alternatively give us the full path to $TESTINGMODULE"
      exit 1
    fi
  fi
  if [ ! -f $TESTINGMODULEDIR/moduledefinition.xml ]; then
    echo Cannot find $TESTINGMODULEDIR/moduledefinition.xml
    exit 1
  fi
  TESTINGMODULENAME=`basename $TESTINGMODULE`
  if [ -z "$TESTLIST" ]; then
    TESTLIST="$TESTINGMODULENAME"
  elif [ "$TESTLIST" != "$TESTINGMODULENAME" ]; then
    RUNEXPLICITTESTS=1
  fi

  echo "Autoadded module: $TESTINGMODULE"
  ADDMODULES="$ADDMODULES $TESTINGMODULE"

  echo "`date` Pulling dependency information for module $TESTINGMODULE"
  # TODO: shouldn't harescript just create /opt/whdata/tmp so stuff just works?
  MODSETTINGS="`$SUDO docker run --rm -i -e WEBHARE_TEMP=/tmp/ -e WEBHARE_DTAPSTAGE=development -e WEBHARE_SERVERNAME=moduletest.webhare.net $WEBHAREIMAGE wh run mod::system/scripts/internal/tests/explainmodule.whscr < $TESTINGMODULEDIR/moduledefinition.xml`"
  ERRORCODE="$?"

  if [ "$ERRORCODE" != "0" ]; then
    echo "Failed to get dependency info, error code: $ERRORCODE"
    exit 1
  fi

  eval $MODSETTINGS

  # Early exit when the module is not meant for this WebHare version
  if [ "$MODULENOTAPPLICABLE" != "" ]; then
    echo ""
    echo "$(c red)****** Module is not applicable for this WebHare version *******$(c reset)"
    echo ""
    exit 0
  fi

else
  if [ -z "$TESTLIST" ]; then
    TESTLIST="all"
  fi
fi

if [ -n "$ADDMODULES" ]; then
  mkdir -p ${TEMPBUILDROOT}/docker-tests/modules
  for MODULE in $ADDMODULES; do
    if [ ! -d "$MODULE" ]; then
      MODULE="`${PWD}/../../whtree/bin/wh getmoduledir $MODULE`"
      if [ -z "$MODULE" ]; then
        exit 1
      fi
    fi
    MODULENAME="$(basename $MODULE)"
    echo "Copying module $MODULENAME"

    # Don't copy files that won't be committed due to default git ignore rules
    mkdir -p "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME"
    if ! (cd $MODULE ; git ls-files -co --exclude-standard | tar -c -T -) | tar -x -C "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME" ; then
      echo "Failed to copy $MODULE"
      exit 1
    fi
  done
fi

mkdir -p ${TEMPBUILDROOT}/docker-tests/modules

# Fetch dependencies
NUMMODULES=${#EXPLAIN_DEPMODULE[*]}
for (( i=0; i<=$(( $NUMMODULES -1 )); i++ ))
do
  MODULENAME=${EXPLAIN_DEPMODULE[$i]}
  MODULE=${EXPLAIN_DEPREPOSITORY[$i]}
  MODULEBRANCH=${EXPLAIN_DEPBRANCH[$i]}

  if [[ $MODULE =~ ^https?://[^/]*/([^/]*)/([^/]*)\.git$ ]]; then
    # Remote git URL
    CLONEURL="$MODULE"
  elif [[ $MODULE =~ ^.*:([^/]*)/([^/]*)\.git$ ]]; then
    # Remote git URL
    CLONEURL="$MODULE"
  else
    # Running in CI?
    if [ -n "$CI_JOB_TOKEN" ]; then
      CLONEURL="https://gitlab-ci-token:${CI_JOB_TOKEN}@gitlab.webhare.com/$MODULE.git"
    else
      CLONEURL="git@gitlab.webhare.com:$MODULE.git"
    fi
  fi

  TARGETDIR=`echo "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME" | tr '[:upper:]' '[:lower:]'`
  if [ -d "$TARGETDIR" ]; then
    continue #already one this module
  fi

  mkdir -p $(dirname $TARGETDIR)

  GITOPTIONS=""
  CLONEINFO=""

  if [ -n "$MODULEBRANCH" ]; then
    GITOPTIONS="$GITOPTIONS --branch $MODULEBRANCH"
    CLONEINFO=" (branch $MODULEBRANCH)"
  fi
  # If we have the module installed, use its git repository for a faster clone
  LOCALDIR=`$BASEDIR/whtree/bin/wh getmoduledir $MODULENAME 2>/dev/null`
  if [ "$LOCALDIR" != "" ] && version_gte $(git --version) 2.11; then
    GITOPTIONS="$GITOPTIONS --reference-if-able $LOCALDIR"
  fi

  echo "Cloning module '$MODULENAME' from '$CLONEURL' into '$TARGETDIR'$CLONEINFO"
  if ! git clone $GITOPTIONS "$CLONEURL" "$TARGETDIR" ; then
    echo "Failed to clone $CLONEURL"
    exit 1
  fi

  ANYMODS=1
done

echo "`date` Creating container $CONTAINER (using image $WEBHAREIMAGE)"

if [ -n "$JSTESTBROWSER" ] && [ -z "$EXPLICITPORT" ] ; then
  DOCKERARGS="$DOCKERARGS -p 8000"
fi
#######################
#
# Create the environment file
set | egrep '^(TESTFW_|WEBHARE_DEBUG)' > ${TEMPBUILDROOT}/env-file

# Switch to DTAP development - most test refuse to run without this option for safety reasons
echo "WEBHARE_DTAPSTAGE=development" >> ${TEMPBUILDROOT}/env-file

# Signal this job is running for a test - we generally try to avoid changing behaviours in testmode, but we want to be nice and eg prevent all CI instances from downloading the geoip database
echo "WEBHARE_CI=1" >> ${TEMPBUILDROOT}/env-file

# Allow whdata to be mounted on ephemeral (overlayfs) storage
echo "WEBHARE_ALLOWEPHEMERAL=1" >> ${TEMPBUILDROOT}/env-file

if [ "$COVERAGE" == "1" ]; then
  echo "WEBHARE_DEBUG=cov" >> ${TEMPBUILDROOT}/env-file
  echo "WEBHARE_DEBUGSESSION=coverage" >> ${TEMPBUILDROOT}/env-file
elif [ "$PROFILE" == "1" ]; then
  echo "WEBHARE_DEBUG=apr" >> ${TEMPBUILDROOT}/env-file
  echo "WEBHARE_DEBUGSESSION=functionprofile" >> ${TEMPBUILDROOT}/env-file
fi

if [ -n "$SELENIUMHOST" ]; then
  echo "WH_SELENIUMHOST=$SELENIUMHOST" >> ${TEMPBUILDROOT}/env-file
fi

if [ -z "$ISMODULETEST" ]; then #not a module test? then we probably need the webhare_testsuite module too  TODO can we cp/grab this from the checked out source tree instead of embedded targz
  echo "WH_EXTRACTTESTSUITE=1" >> ${TEMPBUILDROOT}/env-file
else
  echo "WEBHARE_CONFIGURL=file:///config/serverconfig.xml" >> ${TEMPBUILDROOT}/env-file
fi

CMDLINE="$SUDO docker create -l webharecitype=testdocker -p 80 -p 8000 $DOCKERARGS --env-file ${TEMPBUILDROOT}/env-file --tmpfs /opt/whdata $WEBHAREIMAGE"
echo "Executing: $CMDLINE"
CONTAINER=`$CMDLINE`

if [ -z "$CONTAINER" ]; then
  echo Container creating failed
  exit 1
fi

echo "`date` Created container with id: $CONTAINER"

if [ "$CI_SERVER_HOST" == "gitlab.webhare.com" ]; then # Running on our infra, so predictable paths
  echo ""
  echo "To access the runner:    SV ssh ${CI_RUNNER_DESCRIPTION/.*}"
  echo "To access the container: SV ssh ${CI_RUNNER_DESCRIPTION/-*} docker exec -ti ${CONTAINER} /bin/bash"
  echo ""
fi

if [ -n "$ISMODULETEST" ]; then # for module tests, configure a primary interface URL
  echo "`date` Add serverconfiguration to create a primary interface"

  mkdir "${TEMPBUILDROOT}/config"
  cat > "${TEMPBUILDROOT}/config/serverconfig.xml" << HERE
<serverconfig xmlns="http://www.webhare.net/xmlns/system/serverconfig">
  <bindings>
    <binding name="http" port="80" virtualhost="true" />
  </bindings>
  <webservers>
    <interface name="primaryinterface" virtualhost="true" isprimary="true" baseurl="http://127.0.0.1/" />
  </webservers>
</serverconfig>
HERE
  if ! $SUDO docker cp "${TEMPBUILDROOT}/config" $CONTAINER:/; then
    TESTFAIL=1
    echo "Failed installing the server configuration"
  fi
fi

if [ -n "$ADDMODULES" ]; then
  echo "`date` Copy modules from ${TEMPBUILDROOT}/docker-tests/modules/"
  if ! $SUDO docker cp ${TEMPBUILDROOT}/docker-tests/modules/ $CONTAINER:/opt/whmodules/; then
    TESTFAIL=1
  fi
fi

if [ -z "$ISMODULETEST" -a -d "$BUILDDIR/build" ]; then
  echo "`date` Copying artifacts into $CONTAINER"
  if ! $SUDO docker cp "$BUILDDIR/build" $CONTAINER:/ ; then
    echo "Copy failed!"
    exit 1
  fi
fi

echo "`date` Starting container $CONTAINER"
if ! $SUDO docker start $CONTAINER ; then
  echo Container start failed
  exit 1
fi

if [ -n "$ISMODULETEST" ]; then
  echo "`date` Fixup modules (npm etc)"
  if ! $SUDO docker exec $CONTAINER chown -R root:root /opt/whmodules/; then
    TESTFAIL=1
  fi
  FIXPARAMS=--onlymodules
  if ! $SUDO docker exec $CONTAINER wh fixmodules $FIXPARAMS ; then
    echo ""
    echo "$(c red)****** FIXMODULES FAILED (errorcode $?) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
    echo ""
    TESTFAIL=1
  fi
fi

echo "`date` Wait for poststartdone"
$SUDO docker exec $CONTAINER wh waitfor poststartdone

if [ -n "$ISMODULETEST" ]; then
  # core tests should come with precompiled assetpacks so we only need to wait for module tests
  echo "`date` Check assetpacks"
  if ! $SUDO docker exec $CONTAINER wh assetpacks check ${TESTINGMODULENAME}:"*"; then
    echo ""
    echo "$(c red)****** WAIT ASSETPACKS FAILED (errorcode $?) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
    echo ""
    TESTFAIL=1
  fi

  if [ -z "$RUNEXPLICITTESTS" ]; then
    echo "`date` Check module"
    if ! $SUDO docker exec $CONTAINER wh checkmodule --color $TESTINGMODULENAME ; then
      echo ""
      echo "$(c red)****** CHECK FAILED (errorcode $?) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
      echo ""
      TESTFAIL=1
    fi

    echo "`date` System-wide check (eg against siteprofile inconsistencies)"
    if ! $SUDO docker exec $CONTAINER wh checkwebhare ; then
      echo ""
      echo "$(c red)****** WEBHARE CHECK FAILED (errorcode $?) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
      echo ""
      TESTFAIL=1
    fi
  fi
fi

if [ -n "$GENERATEXMLTESTS" ]; then
  echo "`date` Generate XML tests"
  $SUDO docker exec $CONTAINER wh run modulescript::webhare_testsuite/tests/createxmldomtestscripts.whscr
fi

echo "`date` --- servicemanager log ---"
$SUDO docker logs $CONTAINER
echo "`date` --- end of servicemanager log ---"

echo "`date` Start the actual test"

if [ -n "$JSTESTBROWSER" ]; then
  PORTMAPPING=$(docker port $CONTAINER | grep -e "^8000/" | grep -o "[0-9]*$")
  SKIPS="designfiles $SKIPS"
  HOSTNAME=$(hostname -f)
  ARGS=
  for SKIP in $SKIPS; do
    ARGS="$SKIPARGS --skip $SKIP"
  done
  echo "wh run modulescript::webhare_testsuite/runjstests.whscr --browsers \"$JSTESTBROWSER\" --host $HOSTNAME --port $PORTMAPPING --noinit $SKIPARGS $TESTLIST"

  if ! $SUDO docker exec $CONTAINER wh run modulescript::webhare_testsuite/runjstests.whscr --browsers "$JSTESTBROWSER" --noinit --host $HOSTNAME --port $PORTMAPPING --noinit $SKIPARGS $TESTLIST; then
    echo "$(c red)Tests failed!$(c reset)"
    TESTFAIL=1
  fi
else
  # When module testing, only run runtest if there actually appear to be any tests
  if [ -z "$ISMODULETEST" -o -f "$TESTINGMODULEDIR/tests/testinfo.xml" ]; then
    if ! $SUDO docker exec $CONTAINER wh runtest --outputdir /output --autotests $TERSE $STOPONFAIL $DEBUG $RUNTESTARGS $TESTLIST; then
      echo "$(c red)Tests failed!$(c reset)"
      TESTFAIL=1
    fi
  fi
fi

if [ "$TESTFAIL" == "1" -a "$ENTERSHELL" == "1" ]; then
  echo "Entering shell in container $CONTAINER"
  $SUDO docker exec -ti $CONTAINER /bin/bash
fi

echo "`date` Done with tests"

if [ -z "$ARTIFACTS" ]; then
  if [ -n "$CI_PROJECT_DIR" ]; then
    ARTIFACTS="$CI_PROJECT_DIR/artifacts"
  else
    mkdir -p /tmp/whtest/
    ARTIFACTS="$(mktemp -d /tmp/whtest/test.XXXXXXXXX)"
    echo "Saving artifacts to $ARTIFACTS"
  fi
fi

# Can't use docker cp due to the volume at /opt/whdata/, this method
mkdir -p $ARTIFACTS/
$SUDO docker exec $CONTAINER tar -c -C /opt/whdata/ output | tar -x -C $ARTIFACTS/
$SUDO docker exec $CONTAINER tar -c -C /opt/whdata/ log | tar -x -C $ARTIFACTS/
$SUDO docker exec $CONTAINER tar -c -C / tmp | tar -x -C $ARTIFACTS/

if [ -n "$COVERAGE" ]; then
  $SUDO docker exec $CONTAINER wh run modulescript::system/debug/analyze_coverage.whscr
  $SUDO docker exec $CONTAINER tar -zc -C /opt/whdata/ephemeral/profiles coverage > $ARTIFACTS/coverage.tar.gz
  echo "Copied coverage data to $ARTIFACTS/coverage.tar.gz"
fi

if [ -n "$PROFILE" ]; then
  $SUDO docker exec $CONTAINER tar -zc -C /opt/whdata/ephemeral/profiles functionprofile > $ARTIFACTS/functionprofile.tar.gz
  echo "Copied functionprofile data to $ARTIFACTS/functionprofile.tar.gz"
fi

if [ "`$SUDO docker ps -q -f id=$CONTAINER`" == "" ]; then
  echo "Container exited early!"
  $SUDO docker logs $CONTAINER
fi

if [ "$TESTFAIL" = "0" ]; then
  echo "$(c green).... SUCCESS! no errors recorded$(c reset)"
else
  echo "$(c red).... tests have failed, exiting with errorcode $TESTFAIL$(c reset)"
fi
exit $TESTFAIL
