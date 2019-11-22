# Profiling

WebHare has several methods to collect function profiling information.

## CPU profiles:

- Using whdebug=apr on dynamic webpages. If enabled, cpu profiles for applications will be sent to live view of the profiling
  application (?app=system:profiles). If no profiling app is running, these profiles will be lost

- Using the environment variable `WEBHARE_DEBUG=apr`. If set, cpu profiles are written to the ephemeral/profiles/[currentsession] directory. The session
  can be set with the `WEBHARE_DEBUGSESSION` environment variable. The profiles can be show with the profiling application ?app=system:profiles([session]),
  specify the session to be shown between parentheses

- Dynamically enabled by calling `wh debug setconfig [ -s session ] apr.`. Only takes effect when the WEBHARE_DEBUG environment variable is not set.

- In docker tests, by using `wh testdocker --profile`. The cpu profile will be stored as functionprofile.tar.gz in the artefacts. The profiling application can
  show this by setting the path to that file as parameter (eg ?app=system:profiles(/tmp/whtest/test.dHvuObPS8/functionprofile.tar.gz).

- By connecting to a job with the debugger, and select Menu > Profiles > Start Function Profiling. Retrieve the profile by Menu > Profiles > Stop Profiling.

## Coverage profiles

- Using the environment variable `WEBHARE_DEBUG=cov`. If set, coverage profiles are written to the ephemeral/profiles/[currentsession] directory. The session
  can be set with the `WEBHARE_DEBUGSESSION` environment variable. Analyze by using `wh calculate-coverage`

- Dynamically enabled by calling `wh debug setconfig [ -s session ] cov.`. Only takes effect when the WEBHARE_DEBUG environment variable is not set. Analyze by using
  `wh calculate-coverage`

- In docker tests, by using `wh testdocker --coverage`. The coverage profile will be analyzed immediately and stored as coverage.tar.gz in the artefacts.

## Environment variables and console mode

If the WEBHARE_DEBUG environment variable is when running 'wh console', this variable will be propagated to all processes run with 'wh run'. In that case, they cannot
be changed with 'wh debug setconfig'.



