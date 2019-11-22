# Source global definitions
if [ -f /etc/bashrc ]; then
        . /etc/bashrc
fi

export PATH="$PATH:/opt/mssql-tools/bin"
eval `/opt/wh/whtree/bin/wh setupmyshell`
