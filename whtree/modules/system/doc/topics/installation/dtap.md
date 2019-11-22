# Server type (DTAP)

The type of installation you are running. Modules and applications can change their behaviour based on the dtap stage.

You can request the current DTAP stage using GetDTAPStage() or use IsDtapLive() as a shorthand for 'production or acceptance'

Permanently configuered synchronisation workflows (eg. publisher sync and wrd sync) generally 'flow downwards'. Eg, acceptance syncs from production,
and development may sync from acceptance, but production will never sync from acceptance.

DTAP stage should not be confused with 'restore mode'.

## Production
The server is intended for production usage. Sites are generally on their primary URL, and indexed.

## Acceptance
The server generally hosts copies of production content. Sites are on test URLs.

Amongst the server changes made in this mode are:
- all webservers host a `robots.txt` blocking content indexing

## Test
The server is a (possibly public) testing instance.

Amongst the server changes made in this mode are:
- all changes that are made in acceptance mode

## Development
The server is a local development instance on a private installation. Servers in development mode should
NOT be exposed to the public, as various debugging options are available that may leak information or cause other security
or privacy issues.

Amongst the server changes made in this mode are:
- all changes that are made in acceptance and/or test mode
- all users can trigger Tollium's various inspect modes, retrieving internal information
- CI tests can be run
- various debugging and testing interfaces are made available by the test framework
