# shellcheck shell=bash

# postgres key & repository - https://www.postgresql.org/download/linux/redhat/
dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-$(uname -m)/pgdg-redhat-repo-latest.noarch.rpm"

# Looks like we also need to disable testing repos. see also the many repos in /etc/yum.repos.d/pgdg-redhat-all.repo and whether they're enabled
# If you see 'Error: Failed to download metadata for repo' and it looks unimportant, just disable that repo too
dnf config-manager --set-disabled pgdg*
dnf config-manager --set-enabled pgdg17

# TODO get version number from platform.conf
# TODO -devel package probably not needed on setup-imagebase
# -contrib: for pgcrypto
dnf install -y postgresql17-contrib postgresql17-libs postgresql17-server postgresql17-devel
