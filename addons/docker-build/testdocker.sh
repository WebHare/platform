#!/bin/bash
# shellcheck disable=SC2129
# disable complaints about >> on two lines in a row

# This script is also deployed to https://build.webhare.dev/ci/scripts/testdocker.sh
if [ -f "${BASH_SOURCE%/*}/../../whtree/lib/wh-functions.sh" ] ; then
  # Running from a whtree
  source "${BASH_SOURCE[0]%/*}/../../whtree/lib/wh-functions.sh"
elif [ -f "${BASH_SOURCE%/*}/wh-functions.sh" ]; then
  # Running from a CI which directly downloaded wh-functions.sh
  # shellcheck source=../../whtree/lib/wh-functions.sh
  source "${BASH_SOURCE%/*}/wh-functions.sh"
else
  echo "Unrecognized environment for testdocker"
  exit 1
fi

# Podman testdocker support is still experimental. to try it:
# wh builddocker --podman
# wh testdocker --nopull --podman --webhareimage localhost/webhare/webhare-extern:localbuild --tag=-external checkmodules

version=""
CONTAINERS=()
ORIGINALOPTIONS=()
ORIGINALPARAMS=()
BASEDIR=$(get_absolute_path "$(dirname "$0")/../..")
ALLOWSTARTUPERRORS=""
DOCKERARGS=
TERSE=--terse
EXPLICITWEBHAREIMAGE=
ENTERSHELL=
RUNTESTARGS=()
COVERAGE=
ADDMODULES=
ISMODULETEST=
ISJSPACKAGETEST=
ISPLATFORMTEST=
NOAUTOMODULEDIR=
TESTFAIL=0
FATALERROR=
ARTIFACTS=
NOPULL=0
LOCALDEPS=
NOCHECKMODULE=
FIXEDCONTAINERNAME=
TESTINGMODULENAME=""
USEPODMAN=

HOSTTAROPTIONS=(--no-xattrs)
if [ "$(uname)" == "Darwin" ]; then #prevents eg language/._default.xml files
  HOSTTAROPTIONS+=(--disable-copyfile)
fi

testfail()
{
  echo ""
  echo "$(c red)****** $1 *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
  echo ""
  TESTFAIL=1
}

# WH Version check. use like this:  if is_atleast_version 5.5.0 ; then  CODE TO APPLY TO 5.5.0 AND HIGHER ; fi
is_atleast_version()
{
  [ -z "$version" ] && die "is_atleast_version is invoked too early"
  vercomp "$version" "$1"
  [ "$?" == "2" ] && return 1
  return 0
}

exit_failure_sh()
{
  echo "Test failed:" "$@"

  if [ "$ENTERSHELL" == "1" ]; then
    echo "Starting a shell to debug (you are on the host!)"
    "$SHELL"
  fi
  exit 1
}

mark()
{
  echo "$(date) --- MARK: $1 ---"
  RunDocker exec "$TESTENV_CONTAINER1" wh debug mark "$1"
}

RunDocker()
{
  local retval
  echo "$(date)" "${CONTAINERENGINE[@]}" "$@" >&2
  "${CONTAINERENGINE[@]}" "$@" ; retval="$?"
  if [ "$retval" != "0" ]; then
    echo "$(date)" "${CONTAINERENGINE[@]}" "returned errorcode $retval" >&2
  fi
  return $retval
}

create_container()
{
  local CONTAINERID NR

  NR=$1

  echo "$(date) Creating container$NR (using image $WEBHAREIMAGE)"

  #######################
  #
  # Create the environment file
  true > "${TEMPBUILDROOT}/env-file"

  # Switch to DTAP development - most test refuse to run without this option for safety reasons
  echo "WEBHARE_DTAPSTAGE=development" >> "${TEMPBUILDROOT}/env-file"

  # Signal this job is running for a test - we generally try to avoid changing behaviours in testmode, but we want to be nice and eg prevent all CI instances from downloading the geoip database
  echo "WEBHARE_CI=1" >> "${TEMPBUILDROOT}/env-file"
  if [ -n "$TESTINGMODULENAME" ]; then
    echo "WEBHARE_CI_MODULE=$TESTINGMODULENAME" >> "${TEMPBUILDROOT}/env-file"
  fi

  # Allow whdata to be mounted on ephemeral (overlayfs) storage. This parameter is needed for WH 4.25 - WH 5.5
  echo "WEBHARE_ALLOWEPHEMERAL=1" >> "${TEMPBUILDROOT}/env-file"

  # Set artifact dir
  echo "TESTFW_OUTDIR=/output" >> "${TEMPBUILDROOT}/env-file"

  # Append all our settings. Remap (TESTFW/TESTSECRET)_WEBHARE_ vars to WEBHARE_ - this also allows the testinvoker to override any variable we set so far
  set | grep -E '^(TESTSECRET_|TESTFW_|WEBHARE_DEBUG)' | sed -E 's/^(TESTFW_|TESTSECRET_)WEBHARE_/WEBHARE_/' >> "${TEMPBUILDROOT}/env-file"

  # TODO Perhaps /opt/whdata shouldn't require executables... but whlive definitely needs it and we don't noexec it in prod yet either for now.. so enable for now!. (Also some CI tests are bash scripts and currently require this, but that could otherwise be fixed)
  CONTAINERID="$(RunDocker create -l webharecitype=testdocker -p 80 -p 8000 $DOCKERARGS --tmpfs /tmp/ --tmpfs /opt/whdata:exec --env-file "${TEMPBUILDROOT}/env-file" "$WEBHAREIMAGE")"

  if [ -z "$CONTAINERID" ]; then
    echo Container creating failed
    exit 1
  fi

  if [ -n "$TESTINGMODULE" ]; then
    # We don't want WebHare to start yet so we can (ab)use the already started container to run explainmodules before it really starts
    true > "${TEMPBUILDROOT}/pause-webhare-startup"
    RunDocker cp "${TEMPBUILDROOT}/pause-webhare-startup" "$CONTAINERID":/pause-webhare-startup
  fi

  echo "$(date) Created container with id: $CONTAINERID"
  eval TESTENV_CONTAINER$NR=\$CONTAINERID

  if [ -n "$WEBHARE_CI_ACCESS_DOCKERHOST" ]; then # Running on our infra, so predictable paths
    echo ""
    echo "To access the runner:    ${WEBHARE_CI_ACCESS_DOCKERHOST}"
    echo "To access the container: ${WEBHARE_CI_ACCESS_RUNNER} docker exec -ti ${TESTENV_CONTAINER1} /bin/bash"
    echo ""
  fi

  if [ "$NR" == "1" ]; then
    # Get version info from first container
    # this initializes the'version' variable
    BUILDINFOFILE="$(mktemp)"
    if ! RunDocker cp "$TESTENV_CONTAINER1":/opt/wh/whtree/modules/platform/generated/buildinfo "$BUILDINFOFILE"; then
      RunDocker cp "$TESTENV_CONTAINER1":/opt/wh/whtree/modules/system/whres/buildinfo "$BUILDINFOFILE" || die "Cannot get version information out of container"
    fi

    source "$BUILDINFOFILE"
    echo "WebHare version info:
      committag=$committag
      builddate=$builddate
      buildtime=$buildtime
      branch=$branch
      version=$version"
    rm "$BUILDINFOFILE"
  fi

  if [ -n "$ISPLATFORMTEST" ]; then
    [ -n "$WEBHARE_CHECKEDOUT_TO" ] || die "If we're testing WebHare code code, WEBHARE_CHECKEDOUT_TO must be set"
    # Runs additional verifications
    RunDocker cp "${WEBHARE_CHECKEDOUT_TO}/addons/docker-build/startup-webhare-ci.sh" "$CONTAINERID":/opt/wh/whtree/etc/startup.d/
  fi

  if ! RunDocker start "$CONTAINERID" ; then
    die "Container start failed"
  fi

  CONTAINERS+=("$CONTAINERID")
}

unblock_containers()
{
  echo "$(date) Unblocking startup"
  for CONTAINERID in "${CONTAINERS[@]}"; do
    RunDocker exec "$CONTAINERID" rm /pause-webhare-startup || exit_failure_sh "Failed to unblock container $CONTAINERID"
  done
}

wait_for_poststarts()
{
  echo "$(date) Wait for poststartdone container1"
  if ! RunDocker exec "$TESTENV_CONTAINER1" wh waitfor --timeout 600 poststartdone ; then
    testfail "Wait for poststartdone container1 failed"
    FATALERROR=1
  fi


  echo "$(date) container1 poststartdone, look for errors"
  if ! RunDocker exec "$TESTENV_CONTAINER1" wh run mod::system/scripts/debug/checknoerrors.whscr ; then
    if [ -z "$ALLOWSTARTUPERRORS" ]; then
      testfail "Error logs not clean!"
    else
      echo "$(c red)****** WARNING: Error logs not clean (declare <validation options=\"nostartuperrors\" /> to make this fatal) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
    fi
  fi

  if [ -n "$TESTFW_TWOHARES" ]; then
    echo "$(date) Wait for poststartdone container2"
    if ! RunDocker exec "$TESTENV_CONTAINER2" wh waitfor --timeout 600 poststartdone ; then
      testfail "Wait for poststartdone container2 failed"
      FATALERROR=1
    fi

    echo "$(date) container2 poststartdone, look for errors"
    if ! RunDocker exec "$TESTENV_CONTAINER2" wh run mod::system/scripts/debug/checknoerrors.whscr ; then
      if [ -z "$ALLOWSTARTUPERRORS" ]; then
        testfail "Error logs not clean!"
      else
        echo "$(c red)****** WARNING: Error logs not clean (declare <validation options=\"nostartuperrors\" /> to make this fatal) *******$(c reset)" # we may need to reprint this at the end as the tests generate a lot of noise
      fi
    fi
  fi
}

finalize_tests()
{
  if [ "$ENTERSHELL" == "1" ]; then
    mark "Entering shell in container $TESTENV_CONTAINER1"
    [ "$TESTFAIL" == "1" ] && echo "***NOTE*** THERE WERE ERRORS!"
    RunDocker exec -ti "$TESTENV_CONTAINER1" /bin/bash
  fi

  mark "Done with tests - stopping containers"

  # Stop the containers nicely so we have full logs
  RunDocker exec "$TESTENV_CONTAINER1" sv down webhare
  [ -n "$TESTENV_CONTAINER2" ] && RunDocker exec "$TESTENV_CONTAINER2" sv down webhare

  if [ -z "$ARTIFACTS" ]; then
    if [ -n "$CI_PROJECT_DIR" ]; then
      ARTIFACTS="$CI_PROJECT_DIR/artifacts"
    else
      mkdir -p /tmp/whtest/
      ARTIFACTS="$(mktemp -d /tmp/whtest/test.XXXXXXXXX)"
      echo "Saving artifacts to $ARTIFACTS"
    fi
  fi

  # Can't use docker cp due to the volume at /opt/whdata/
  mkdir -p $ARTIFACTS/whdata
  RunDocker exec "$TESTENV_CONTAINER1" tar -c -C /opt/whdata/ output log tmp | tar -x -C "$ARTIFACTS/whdata/"
  RunDocker exec "$TESTENV_CONTAINER1" tar -c -C / tmp | tar -x -C "$ARTIFACTS/"
  # For consistency we should probably get everyone inside the container to dump any artifacts in $TESTFW_OUTPUT
  RunDocker exec "$TESTENV_CONTAINER1" tar -c -C /output/ . | tar -x -C "$ARTIFACTS/"
  if is_atleast_version 5.7.0 ; then
    RunDocker cp $TESTENV_CONTAINER1:/opt/wh/whtree/modules/platform/generated/buildinfo "$ARTIFACTS/buildinfo"
  else
    RunDocker cp $TESTENV_CONTAINER1:/opt/wh/whtree/modules/system/whres/buildinfo "$ARTIFACTS/buildinfo"
  fi

  # Promote jstests failure logs + screenshots to the root dir
  [ -d "$ARTIFACTS/tmp/jstests" ] && mv "$ARTIFACTS/tmp/jstests"/* "$ARTIFACTS/"

  if [ -n "$TESTFW_EXPORTMODULE" ]; then
    RunDocker exec "$TESTENV_CONTAINER1" tar -c -C /opt/whdata/installedmodules $TESTINGMODULENAME | gzip - > $ARTIFACTS/$TESTINGMODULENAME.whmodule
  fi

  if [ -n "$TESTFW_TWOHARES" ]; then
    mkdir -p $ARTIFACTS/whdata2
    RunDocker exec $TESTENV_CONTAINER2 tar -c -C /opt/whdata/ output log tmp | tar -x -C $ARTIFACTS/whdata2/
    RunDocker exec $TESTENV_CONTAINER2 tar -c -C / tmp | tar -x -C $ARTIFACTS/tmp2/
  fi

  if [ -n "$COVERAGE" ]; then
    RunDocker exec "$TESTENV_CONTAINER1" wh run mod::system/scripts/debug/analyze_coverage.whscr
    RunDocker exec "$TESTENV_CONTAINER1" tar -zc -C /opt/whdata/ephemeral/profiles default > $ARTIFACTS/coverage.tar.gz
    echo "Copied coverage data to $ARTIFACTS/coverage.tar.gz"
  fi

  if [ -n "$WEBHARE_PROFILE" ]; then
    RunDocker exec "$TESTENV_CONTAINER1" tar -zc -C /opt/whdata/ephemeral/profiles default > $ARTIFACTS/functionprofile.tar.gz
    echo "Copied functionprofile data to $ARTIFACTS/functionprofile.tar.gz"
  fi

  if [ "$(RunDocker ps -q -f id=$TESTENV_CONTAINER1)" == "" ]; then
    echo "Container1 exited early!"
    RunDocker logs $TESTENV_CONTAINER1
  fi
  if [ -n "$TESTFW_TWOHARES" -a "$(RunDocker ps -q -f id=$TESTENV_CONTAINER2)" == "" ]; then
    echo "Container2 exited early!"
    RunDocker logs $TESTENV_CONTAINER2
  fi

  if [ "$TESTFAIL" = "0" ]; then
    echo "$(c green).... SUCCESS! no errors recorded$(c reset)"
  else
    echo "$(c red).... tests have failed, exiting with errorcode $TESTFAIL$(c reset)"
  fi
  exit $TESTFAIL
}

print_syntax()
{
  # Note that we only document the options most likely to stay in the future
  # A lot of undocumented options eg --twohares are only intended for specific platform CI tests
  cat << HERE
wh testdocker [options]

Options:
-m <module>             - Test the specified module
--containername <name>  - Force this name for the CI container
--nopull                - Do not pull the image (implicit with --webhareimage localbuild)
--webhareimage <image>  - Use this image. Image tags 'main/beta/stable' correspond to their release channels.
                          Image 'localbuild' refers to webhare/webhare-extern:localbuild as built by 'wh builddocker'. This is the default
--nocheckmodule         - Do not run checkmodule before the actual tests
--sh                    - Open a shell inside the container after running the tests
--podman                - Use podman instead of docker
HERE
}


while true; do
  # Add option to the proper array for command line reconstruction
  if [[ $1 =~ ^- ]]; then
    ORIGINALOPTIONS+=("$1")
  else
    ORIGINALPARAMS+=("$1")
  fi

  if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    print_syntax
    exit 0
  fi
  if [ "$1" == "--containername" ]; then
    FIXEDCONTAINERNAME="$2"
    DOCKERARGS="$DOCKERARGS --name=${FIXEDCONTAINERNAME}"
    shift
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--coverage" ]; then
    shift
    COVERAGE=1
    WEBHARE_PROFILE=
  elif [ "$1" == "--profile" ]; then
    shift
    WEBHARE_PROFILE=1
    COVERAGE=
  elif [ "$1" == "--nopull" ]; then
    shift
    NOPULL=1
  elif [ "$1" == "--noterse" ]; then
    TERSE=
    shift
  elif [ "$1" == "--nocheckmodule" ]; then
    NOCHECKMODULE=1
    shift
  elif [ "$1" == "--sh" ]; then
    ENTERSHELL=1
    shift
  elif [[ "$1" =~ ^--tag= ]] || [ "$1" == "--loop" ] || [ "$1" == "-d" ] || [ "$1" == "--breakonerror" ]|| [ "$1" == "--untilfail" ]; then
    RUNTESTARGS+=("$1")
    shift
  elif [ "$1" == "--privileged" ]; then
    DOCKERARGS="$DOCKERARGS --privileged"
    shift
  elif [ "$1" == "--env" ]; then # docker env
    shift
    DOCKERARGS="$DOCKERARGS --env $1"
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--port" ]; then
    shift
    DOCKERARGS="$DOCKERARGS -p $1:13679"
    shift
  elif [ "$1" == "--generatexmltests" ]; then
    GENERATEXMLTESTS=1
    shift
  elif [ "$1" == "--skips" ]; then
    shift
    SKIPS="$SKIPS $1"
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--addmodule" ] || [ "$1" == "-a" ]; then
    shift
    ADDMODULES="$ADDMODULES $1"
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--podman" ]; then
    USEPODMAN="1"
    shift
  elif [ "$1" == "--webhareimage" ] || [ "$1" == "-w" ]; then
    shift
    WEBHAREIMAGE="$1"
    EXPLICITWEBHAREIMAGE=1
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--output" ] || [ "$1" == "-o" ]; then
    shift
    ARTIFACTS=$(get_absolute_path "$1")
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "-m" ] || [ "$1" == "--module" ]; then
    ISMODULETEST=1
    shift
  elif [ "$1" == "--noautomoduledir" ]; then
    NOAUTOMODULEDIR=1
    shift
  elif [ "$1" == "--jspackage" ]; then
    ISJSPACKAGETEST=1
    export TESTFW_WEBHARE_ENABLE_DEVKIT=1 #The actual test logic is in the devkit
    shift
  elif [ "$1" == "--twohares" ] ; then
    TESTFW_TWOHARES=1
    shift
  elif [ "$1" == "--testscript" ] ; then
    shift
    TESTSCRIPT=$1
    ORIGINALOPTIONS+=("$1")
    shift
  elif [ "$1" == "--localdeps" ] ; then
    LOCALDEPS=1
    shift
  elif [[ $1 =~ ^- ]]; then
    echo "Illegal option '$1'. Use 'wh testdocker --help' for help"
    exit 1
  else
    break
  fi
done


IMPLICITARGS=()
if [ -n "$ISMODULETEST" ]; then
  [ -z "$ISPACKAGETEST" ] || die "Cannot specify both --jspackage and --m"
  if [ -n "$CI_PROJECT_DIR" ] && [ -z "$NOAUTOMODULEDIR" ]; then
    TESTINGMODULE="$CI_PROJECT_DIR"
    TESTINGMODULENAME="$(basename "$TESTINGMODULE")"
    IMPLICITARGS+=("$TESTINGMODULENAME")
  else
    TESTINGMODULE="${1%%.*}"
    TESTINGMODULENAME="$(basename "$TESTINGMODULE")"
    shift
    if [ -z "$TESTINGMODULE" ]; then
      echo "Please specify a testmodule to run"
      exit 1
    fi
  fi
  TESTINGMODULEREF="${TESTINGMODULENAME}"
elif [ -n "$ISJSPACKAGETEST" ]; then
  if [ -n "$CI_PROJECT_DIR" ]; then
    TESTINGMODULE="$CI_PROJECT_DIR"
    TESTINGMODULENAME="$(basename "$TESTINGMODULE")"
    IMPLICITARGS+=("$TESTINGMODULENAME")
  else
    TESTINGMODULE="$(cd "$1" ; pwd)"
    [ -f "${TESTINGMODULE}/package.json" ] || die "Invalid package in $TESTINGMODULE"
    TESTINGMODULENAME="$TESTINGMODULE"
    shift
    [ -n "$TESTINGMODULE" ] || die "Please specify a package to run"
  fi
  TESTINGMODULEREF="jspackagetest"
else
  [ -n "$WEBHARE_CHECKEDOUT_TO" ] || die "If we're testing WebHare code code, WEBHARE_CHECKEDOUT_TO must be set"
  ISPLATFORMTEST=1
  # Reference to the module being tested, 'platform' when we're testing WebHare's core (allows us to share code between module and core test as some scripts accept 'platform' as a module name)
  TESTINGMODULEREF="platform"
fi

if [ "$COVERAGE" == "1" ]; then
  WEBHARE_DEBUG="cov,$WEBHARE_DEBUG"
elif [ "$WEBHARE_PROFILE" == "1" ]; then
  WEBHARE_DEBUG="apr,$WEBHARE_DEBUG"
fi

CONTAINERENGINE=()
if [ "$DOCKERSUDO" == "1" ]; then
  CONTAINERENGINE+=(sudo)
fi
if [ -n "$USEPODMAN" ]; then
  CONTAINERENGINE+=(podman)
else
  CONTAINERENGINE+=(docker)
fi

if "${CONTAINERENGINE[@]}" inspect "${FIXEDCONTAINERNAME}" >/dev/null 2>&1 ; then
  if ! RunDocker rm -f "$FIXEDCONTAINERNAME" ; then
    exit_failure_sh Unable to cleanup existing image "$FIXEDCONTAINERNAME"
  fi
fi


TESTLIST="$@"
BUILDDIR="$PWD"
cd "$(dirname "$0")" || die "Cannot change to script directory"

if [ -n "$TESTSECRET_SECRETSURL" ]; then
  eval "$(curl --fail --silent "$TESTSECRET_SECRETSURL")"
  unset TESTSECRET_SECRETSURL
fi

if [ -z "$ISPLATFORMTEST" ] && [ -z "$WEBHAREIMAGE" ]; then
  WEBHAREIMAGE="webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}"
  NOPULL=1
  if ! RunDocker inspect "$WEBHAREIMAGE" >/dev/null 2>&1 ; then
    exit_failure_sh "Cannot find localbuild image $WEBHAREIMAGE, please run 'wh builddocker' first or use --webhareimage [main/stable/beta/...]"
  fi
fi

# We're renaming 'head' to 'main' as 'head' is confusing
[ "$WEBHAREIMAGE" == "head" ] && WEBHAREIMAGE=main

if [ "$WEBHAREIMAGE" == "main" ] || [ "$WEBHAREIMAGE" == "stable" ] || [ "$WEBHAREIMAGE" == "beta" ]; then
  WEBHAREIMAGE="$(curl --silent --fail https://www.webhare.dev/meta/buildimage/$WEBHAREIMAGE)"
  if [ -z "$WEBHAREIMAGE" ]; then
    exit_failure_sh "Cannot retrieve actual image to use for image alias $WEBHAREIMAGE"
  fi
fi

if [ -z "$WEBHAREIMAGE" ]; then
  get_finaltag
  list_finaltag
  WEBHAREIMAGE=$BUILD_IMAGE
  if [ "$WEBHAREIMAGE" == "webhare/webhare-extern:localbuild${WEBHARE_LOCALBUILDIMAGEPOSTFIX}" ]; then
    NOPULL=1
  fi
fi

if [[ "$WEBHAREIMAGE" = "webhare/webhare-core:4.18" ]]; then
  WEBHAREIMAGE=webhare/webhare-core:4.18-withts
  RUNTESTARGS+=(--allownomatch)
fi

if [ -n "$USEPODMAN" ] && [[ $(type -t whhook_prepare_podman) == function ]]; then
  whhook_prepare_podman # Allow wh script hooks to prepare the build machine
fi

# Reproduce a valid command line.
echo
echo -n "** To run this test locally: "
while IFS='=' read -r -d '' n v; do
  if [[ "$n" =~ ^(TESTFW_|WEBHARE_DEBUG|DOCKERARGS) ]]; then
    # printf "'%s'='%s' " "$n" "$v" - more safe but 'ugly' :-)
    printf "%s=%s " "$n" "$v"
  fi
done < <(env -0)
echo -n "wh testdocker "
# Add --sh if it wasn't there yet
[ -n "$ENTERSHELL" ] || echo -n "--sh "
# Add original options, followed by a space...
echo -n "${ORIGINALOPTIONS[@]}" ""
[ -z "$EXPLICITWEBHAREIMAGE" ] && echo -n "--webhareimage $WEBHAREIMAGE "
echo -n "${ORIGINALPARAMS[@]}" ""
echo "${IMPLICITARGS[@]}"
echo

# List our configuration
echo "Test environment variables:"
# not listing CI_, lots of noise and usually not really relevant anymore at this point. Just look at the BUILD setup if you want these
set | grep -e '^(TESTFW_|WEBHARE_DEBUG|DOCKERARGS=)' | sort
set | grep ^TESTSECRET_|sed -e '/=.*/s//=xxxxx/' | sort
echo ""

##### *Now* we get to work (we've dumped as much config information as useful)

# Pull the image
if [ "$NOPULL" != "1" ]; then
  # If an alternate registry is set, prefer to use that one. Try to avoid dockerhub, it seems slower and is rate limited
  if [[ $WEBHAREIMAGE =~ docker.io/webhare/platform:.* ]] && [ -n "$WH_CI_ALTERNATEREGISTRY" ] ; then
    if [ -n "$WH_CI_ALTERNATEREGISTRY_LOGIN" ] ; then
      echo "$WH_CI_ALTERNATEREGISTRY_PASSWORD" | docker login -u "$WH_CI_ALTERNATEREGISTRY_LOGIN" --password-stdin "$WH_CI_ALTERNATEREGISTRY"
    fi

    ALTERNATEIMAGE=${WH_CI_ALTERNATEREGISTRY}:${WEBHAREIMAGE:27}  # 27 is the length of 'docker.io/webhare/platform:'

    if RunDocker pull "$ALTERNATEIMAGE" ; then
      [ -n "$WH_CI_ALTERNATEREGISTRY_LOGIN" ] && RunDocker logout "$WH_CI_ALTERNATEREGISTRY"
      WEBHAREIMAGE="$ALTERNATEIMAGE"
    else
      echo "Failed to pull image from alternate registry using the WH_CI_ALTERNATEREGISTRY credentials"
      [ -n "$WH_CI_ALTERNATEREGISTRY_LOGIN" ] && RunDocker logout "$WH_CI_ALTERNATEREGISTRY"

      if ! RunDocker pull "$WEBHAREIMAGE" ; then
        exit_failure_sh "Failed to pull image"
      fi
    fi
  else
    if ! RunDocker pull "$WEBHAREIMAGE" ; then
      exit_failure_sh "Failed to pull image"
    fi
  fi
fi

# Cleanup
TEMPBUILDROOT=
TESTENV_CONTAINER1=

function cleanup()
{
  SUDOCMD=""
  if [ -n "$SUDO" ]; then # build a version with space for nicer alignment of our output
    SUDOCMD="$SUDO "
  fi

  if [ -n "$TESTENV_CONTAINER1" ]; then
    if [ -n "$TESTENV_KILLCONTAINER1" ]; then
      RunDocker kill "$TESTENV_CONTAINER1"
    else
      RunDocker stop "$TESTENV_CONTAINER1"
    fi

    # [ "$TESTFAIL" == "0" ] || RunDocker logs $TESTENV_CONTAINER1
    RunDocker rm "$TESTENV_CONTAINER1"
  fi
  if [ -n "$TESTENV_CONTAINER2" ]; then
    if [ -n "$TESTENV_KILLCONTAINER2" ]; then
      RunDocker kill "$TESTENV_CONTAINER2"
    else
      RunDocker stop "$TESTENV_CONTAINER2"
    fi

    # [ "$TESTFAIL" == "0" ] || RunDocker logs $TESTENV_CONTAINER2
    RunDocker rm "$TESTENV_CONTAINER2"
  fi
  if [ -n "$TEMPBUILDROOT" ]; then
    echo "$(date) Cleanup: remove buildroot $TEMPBUILDROOT"
    rm -rf -- "$TEMPBUILDROOT"
  fi
}
trap cleanup EXIT

if [ -z "$DOCKERBUILDFOLDER" ]; then
  DOCKERBUILDFOLDER="/tmp/"
fi

# Independent tempdir
TEMPBUILDROOT=$DOCKERBUILDFOLDER/$$$(date | (md5 2>/dev/null || md5sum) | head -c8)
mkdir -p ${TEMPBUILDROOT}/docker-tests/modules

if [ -z "$ISPLATFORMTEST" ]; then # Tell the shutdownscript to use 'kill' as sleep won't respond to 'stop'
  TESTENV_KILLCONTAINER1=1
  TESTENV_KILLCONTAINER2=1
fi

if [ -n "$ISPLATFORMTEST" ]; then # NOTE: we *also* know we're running 5.4 then, as platform CI doesn't use an external testmodule.sh
  TESTINGMODULE="webhare_testsuite"
  TESTINGMODULEDIR="${PWD}/../../whtree/modules/webhare_testsuite"

  if [ -z "$TESTLIST" ]; then
    TESTLIST="all"
  fi
elif [ -n "$ISMODULETEST" ]; then
  TESTINGMODULEDIR="$TESTINGMODULE" # we look in the current directory first

  if [ ! -d "$TESTINGMODULEDIR" ]; then
    if [ -z "$CI_JOB_TOKEN" ]; then #doesn't appear to be CI, so give wh a shot to expand to the full module name
      TESTINGMODULEDIR="$(../../whtree/bin/wh getmoduledir "$TESTINGMODULE")"
      echo TESTINGMODULEDIR=$TESTINGMODULEDIR
    fi
    if [ ! -d "$TESTINGMODULEDIR" ]; then
      echo "Cannot find module $TESTINGMODULE - we require the base module to be checked out so we can extract dependency info"
      echo "Alternatively give us the full path to $TESTINGMODULE"
      exit_failure_sh "Dependency extraction failed"
    fi
  fi
fi

create_container 1 #once a container is created, we have the version number
echo "Container 1: $TESTENV_CONTAINER1"

if ! is_atleast_version 5.5.0 ; then
  echo "version macro broke or unsupported webhare version for this testdocker.sh ($version)"
fi


if [ -n "$TESTFW_TWOHARES" ]; then
  create_container 2
  echo "Container 2: $TESTENV_CONTAINER2"
fi

if [ -z "$ISPLATFORMTEST" ] && [ -z "$EXPLAIN_OPTION_NOSTARTUPERRORS" ]; then
  ALLOWSTARTUPERRORS=1
elif [ -n "$ISPLATFORMTEST" ]; then
  ALLOWSTARTUPERRORS=1 #it turns out startup error detection was broken for core webhare too (runwasm didn't return errors). disable the check until we've got clean logs
fi

if [ -z "$TESTLIST" ]; then
  TESTLIST="$TESTINGMODULENAME"
fi

if [ -n "$ISJSPACKAGETEST" ]; then
  DESTCOPYDIR="/testpackage/"
  RunDocker exec "$TESTENV_CONTAINER1" mkdir "$DESTCOPYDIR"
  tar "${HOSTTAROPTIONS[@]}" -C "${TESTINGMODULE}" -c . | RunDocker exec -i "$TESTENV_CONTAINER1" tar -C "$DESTCOPYDIR" -x || exit_failure_sh "Module copy failed!"
  unblock_containers
  wait_for_poststarts
  if is_atleast_version 5.7.0 ; then # only 5.7.0+ ships with useful testscripts
    if ! RunDocker exec "$TESTENV_CONTAINER1" wh devkit:testjspackage "$DESTCOPYDIR" ; then
      testfail "testjspackage failed"
    fi
  fi
  finalize_tests # should exit with 0 or 1 depending on the test results

  # shellcheck disable=SC2317  # Don't warn about unreachable commands in this file - it's here just in case until we have.. expect-shellcheck-error?
  exit 255
fi

# TODO: shouldn't harescript just create /opt/whdata/tmp so stuff just works?
RunDocker exec "$TESTENV_CONTAINER1" mkdir /opt/whdata/tmp/

if [ -f "$TESTINGMODULEDIR/moduledefinition.xml" ]; then
  echo "$(date) Pulling dependency information for module $TESTINGMODULE"
  MODSETTINGS="$(RunDocker exec -i "$TESTENV_CONTAINER1" env WEBHARE_DTAPSTAGE=development WEBHARE_SERVERNAME=moduletest.webhare.net wh run mod::system/scripts/internal/tests/explainmodule.whscr < "$TESTINGMODULEDIR"/moduledefinition.xml)"
  ERRORCODE="$?"
elif [ -f "$TESTINGMODULEDIR/moduledefinition.yml" ]; then
  # TODO we need a YML dep scanner - and probably learn to look if the 'yml' contains a 'dependencies' section before we decide to scan the XML file
  ERRORCODE="0"
else
  exit_failure_sh "Cannot find $TESTINGMODULEDIR/moduledefinition.xml/yml"
fi

if [ "$ERRORCODE" != "0" ]; then
  exit_failure_sh "Failed to get dependency info, error code: $ERRORCODE"
fi

eval $MODSETTINGS

# Early exit when the module is not meant for this WebHare version
if [ "$MODULENOTAPPLICABLE" != "" ]; then
  echo ""
  echo "$(c red)****** Module is not applicable for this WebHare version: $MODULENOTAPPLICABLE *******$(c reset)"
  echo ""
  exit 0
fi


# Fetch dependencies
NUMMODULES=${#EXPLAIN_DEPMODULE[*]}
for (( i=0; i<=$(( $NUMMODULES -1 )); i++ ))
do
  MODULENAME=${EXPLAIN_DEPMODULE[$i]}
  MODULE=${EXPLAIN_DEPREPOSITORY[$i]}
  MODULEBRANCH=${EXPLAIN_DEPBRANCH[$i]}

  if [ -n "$LOCALDEPS" ]; then
    ADDMODULES="$ADDMODULES $MODULENAME"
    continue
  fi;

  if [[ $MODULE =~ ^https?://.*\.git$ ]]; then
    # Remote git URL
    CLONEURL="$MODULE"
  elif [[ $MODULE =~ ^git:.*\.git$ ]]; then
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

  mkdir -p "$(dirname "$TARGETDIR")"

  GITOPTIONS=""
  CLONEINFO=""

  if [ -n "$MODULEBRANCH" ]; then
    GITOPTIONS="$GITOPTIONS --branch $MODULEBRANCH"
    CLONEINFO=" (branch $MODULEBRANCH)"
  fi
  # If we have the module installed, use its git repository for a faster clone
  LOCALDIR="$("$BASEDIR/whtree/bin/wh" getmoduledir $MODULENAME 2>/dev/null)"
  if [ "$LOCALDIR" != "" ]; then
    GITOPTIONS="$GITOPTIONS --reference-if-able $LOCALDIR"
  fi

  echo "Cloning module '$MODULENAME' from '$CLONEURL' into '$TARGETDIR'$CLONEINFO"
  if ! git clone --recurse-submodules $GITOPTIONS "$CLONEURL" "$TARGETDIR" ; then
    exit_failure_sh "Failed to clone $CLONEURL"
  fi
done

for MODULE in "$TESTINGMODULEDIR" $ADDMODULES; do
  if [ ! -d "$MODULE" ]; then
    if [ -z "$CI_JOB_TOKEN" ]; then
      MODULEDIR="`${PWD}/../../whtree/bin/wh getmoduledir $MODULE`"
      if [ -z "$MODULEDIR" ]; then
        exit_failure_sh "Unable to get module dir for $MODULE"
      fi
      MODULE="$MODULEDIR"
    else
      exit_failure_sh "Missing module $MODULE"
    fi
  fi

  MODULENAME="$(basename $MODULE)"
  echo "Copying module $MODULENAME"

  # Don't copy files that won't be committed due to default git ignore rules
  mkdir -p "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME"
  if [ -d "$MODULE/.git" ]; then
    if ! (cd $MODULE ; git ls-files -co --exclude-standard | tar -c -T -) | tar -x -C "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME" ; then
      exit_failure_sh "Failed to copy $MODULE"
    fi
  else
    # non-git module, just copy all
    mkdir -p "${TEMPBUILDROOT}/docker-tests/modules/"
    cp -a "$MODULE" "${TEMPBUILDROOT}/docker-tests/modules/"
    # TODO honor .gitignore
    # Remove wh fixmodules managed node_modules, wh fixmodules should apply them (keeps us closer to a CI environment)
    rm -r "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME"/node_modules "${TEMPBUILDROOT}/docker-tests/modules/$MODULENAME"/webdesigns/*/node_modules 2>/dev/null
  fi
done

echo "$(date) Running prestart"

for CONTAINERID in "${CONTAINERS[@]}"; do
  DESTCOPYDIR=/opt/whdata/installedmodules/ # we don't need the intermediate /webhare-ci-modules/ anymore now we can directly access /opt/whdata/

  # /. ensures that the contents are copied into the directory whether or not it exists (https://docs.docker.com/engine/reference/commandline/cp/)
  # cp doesn't work for tmpfs - https://docs.docker.com/reference/cli/docker/container/cp/#corner-cases
  # RunDocker cp "${TEMPBUILDROOT}/docker-tests/modules/." "$CONTAINERID:$DESTCOPYDIR" || exit_failure_sh "Module copy failed!"
  RunDocker exec -i "$CONTAINERID" mkdir -p "$DESTCOPYDIR"
  tar "${HOSTTAROPTIONS[@]}" -C "${TEMPBUILDROOT}/docker-tests/modules/" -c . | RunDocker exec -i "$CONTAINERID" tar -C "$DESTCOPYDIR" -x || exit_failure_sh "Module copy failed!"

  if [ -n "$ISPLATFORMTEST" ] && [ -d "$BUILDDIR/build" ]; then
    RunDocker cp "$BUILDDIR/build" "$CONTAINERID:/" || exit_failure_sh "Artifact copy failed!"
  fi

  # Find prehooks (TODO Move inside webhare image and perhaps have it try to follow the dependency order)
  for SCRIPT in $(RunDocker exec "$CONTAINERID" find $DESTCOPYDIR -regex "${DESTCOPYDIR}[^/]+/scripts/hooks/ci-prestart.sh" -executable ); do
    RunDocker exec -i "$CONTAINERID" "$SCRIPT" "$version" "$TESTINGMODULENAME" || exit_failure_sh "ci-prestart failed"
  done
done

# Tell our cleanup script it should now just 'stop' the containers
TESTENV_KILLCONTAINER1=""
TESTENV_KILLCONTAINER2=""

echo "$(date) Running fixmodules"
for CONTAINERID in "${CONTAINERS[@]}"; do
  if ! RunDocker exec "$TESTENV_CONTAINER1" wh fixmodules --nocompile --onlyinstalledmodules ; then
    testfail "wh fixmodules failed"
  fi
done

unblock_containers

echo "$(date) Waiting for assetpack compilation"
for CONTAINERID in "${CONTAINERS[@]}"; do
  RunDocker exec "$CONTAINERID" wh assetpack wait "*"
  RunDocker exec "$CONTAINERID" wh assetpack --quiet recompile --onlyfailed "*"  # Note 're'compile is a hidden but still available API in 5.7
done

wait_for_poststarts

if [ -z "$FATALERROR" ]; then
  if [ -z "$NOCHECKMODULE" ] ; then
    echo "$(date) Starting global module tests (use --nocheckmodule in all but one step to skip this to speed up parallelized CIs)"
    # assetpack compiles are much more complex and may rely on siteprofiles etc working, so it's best to find any validation errors first.
    # besides, the assetpack compile should run in the background and validation may take a while, so this parallelizes more
    echo "$(date) Check module $TESTINGMODULEREF"
    CHECKMODULEOPTS=()
    CHECKMODULEOPTS+=(--hidehints)
    CHECKMODULEOPTS+=(--async)

    if ! RunDocker exec "$TESTENV_CONTAINER1" wh checkmodule "${CHECKMODULEOPTS[@]}" --color "$TESTINGMODULEREF" ; then
      testfail "wh checkmodule failed"
    fi

    echo "$(date) System-wide check (eg against siteprofile inconsistencies)"
    if ! RunDocker exec "$TESTENV_CONTAINER1" wh checkwebhare ; then
      testfail "wh checkwebhare failed"
    fi

    echo "$(date) Audit module $TESTINGMODULEREF"
    RunDocker exec "$TESTENV_CONTAINER1" mkdir /output/ # it doesn't exist yet (runtest.whscr would otherwise create it?)
    if ! RunDocker exec "$TESTENV_CONTAINER1" wh platform:auditmodule --outputfile /output/auditmodule.json "$TESTINGMODULEREF" ; then
      testfail "Module audit failed"
      FATALERROR=1
    fi
  fi # ends --nocheckmodule not set

  # core tests should come with precompiled assetpacks so we only need to wait for module tests
  # the assetpack check may be obsolete soon now as fixmodules now implies it (since 4.35, but testdocker will also run for older versions!)
  echo "$(date) Check assetpacks"
  RunDocker exec "$TESTENV_CONTAINER1" wh assetpack check "*:*"
  RETVAL="$?"
  if [ "$RETVAL" != "0" ]; then  #NOTE: wait for ALL assetpacks. might be nicer to wait only for dependencies, but we can't wait for just our own
    testfail "wait assetpacks failed (errorcode $RETVAL)"
  fi
fi

if [ -n "$GENERATEXMLTESTS" ] && [ -z "$FATALERROR" ]; then
  echo "$(date) Generate XML tests"
  RunDocker exec "$TESTENV_CONTAINER1" wh run mod::webhare_testsuite/scripts/tests/createxmldomtestscripts.whscr
fi

echo "$(date) --- container1 servicemanager log ---"
RunDocker logs "$TESTENV_CONTAINER1"
echo "$(date) ^^^ container1 servicemanager log ^^^"

if [ -n "$TESTFW_TWOHARES" ]; then
  echo "$(date) --- container2 servicemanager log ---"
  RunDocker logs "$TESTENV_CONTAINER2"
  echo "$(date) ^^^ container2 servicemanager log ^^^"
fi

if [ -z "$FATALERROR" ]; then
  mark "Start the actual test(s)"

  if [ -n "$TESTSCRIPT" ]; then

    mark "Executing custom test script: $TESTSCRIPT"

    export TESTENV_CONTAINER1
    export TESTENV_CONTAINER2

    if ! $TESTSCRIPT ; then
      testfail "The testscript $TESTSCRIPT failed"
    fi

  else
    # When module testing, only run runtest if there actually appear to be any tests
    if [ -n "$ISPLATFORMTEST" ] || [ -f "$TESTINGMODULEDIR/tests/testinfo.xml" ]; then
      if ! RunDocker exec "$TESTENV_CONTAINER1" wh runtest --outputdir /output --autotests $TERSE "${RUNTESTARGS[@]}" $TESTLIST; then
        testfail "One or more tests failed"
      fi
    fi
  fi
fi

if [ -n "$ISPLATFORMTEST" ] && [ -z "$TESTFW_SKIP_FINALIZE_CI" ]; then
  RunDocker cp "${WEBHARE_CHECKEDOUT_TO}/addons/docker-build/finalize-webhare-ci.sh" "$TESTENV_CONTAINER1:/"
  if ! RunDocker exec "$TESTENV_CONTAINER1" /finalize-webhare-ci.sh ; then
    testfail "finalize-webhare-ci.sh reported errors"
  fi
fi

finalize_tests
