# System-wide .bashrc file for interactive bash(1) shells. Overwritten for WebHare

# To enable the settings / commands in this file for login shells as well,
# this file has to be sourced in /etc/profile.

if [ -n "$WEBHARE_IN_DOCKER" ]; then

  # If not running interactively, don't do anything
  [ -z "$PS1" ] && return

  # check the window size after each command and, if necessary,
  # update the values of LINES and COLUMNS.
  shopt -s checkwinsize

  #Add MS SQL tools to the path (may not exist though, depending on how you built the container)
  export PATH="$PATH:/opt/mssql-tools/bin"

  # Disconnect after 15 seconds of inactivity
  TMOUT=900

  # Install 'wh' shortcuts and tab completions
  eval `/opt/wh/whtree/bin/wh setupmyshell`
fi

# History configuration
## Save 500 lines of history in memory
export HISTSIZE=500
## Save 2,000,000 lines of history to disk
export HISTFILESIZE=2000000
## Append to history instead of overwrite
shopt -s histappend
## Multiple commands on one line show up as a single line
shopt -s cmdhist
## Ignore redundant or space commands
export HISTCONTROL=
## Set time format
export HISTTIMEFORMAT='%F %T '

# Set prompt - we overwrote bashrc so it's our problem now
export PS1='\u@\h:\w\$ '
# Go to home directory so docker exec /bin/bash ends up there
cd
