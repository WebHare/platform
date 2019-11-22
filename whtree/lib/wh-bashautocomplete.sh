# WH autocomplete file

_autocomplete_whcd()
{
  local CUR MODULEPREFIX DIR MODULE MODULES DIRS i

  COMPREPLY=()

  if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
    echo "WebHare whcd autocomplete" > /tmp/lastcomplete
    set | grep ^COMP >> /tmp/lastcomplete
  fi

  CUR="${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" == "1" ]; then
    MODULEPREFIX=${CUR%%/*}
    PREFIX=

    if [ "$MODULEPREFIX" == "$CUR" ]; then
      # no slash, return module list
      MODULES=`wh getmodulelist`

      # Get dirs (no spaces expected in module names)
      DIRS=($(compgen -W "$MODULES" -- "${CUR}"))
    else
      # Go to module dir, then try to autocomplete subpath
      PREFIX=$MODULEPREFIX/
      SUBPATH=${CUR#$PREFIX}
      DIR="`wh getmoduledir $MODULEPREFIX`"
      pushd "$DIR" > /dev/null

      # Autocomplete, results are separated by newline (can contain spaces, so override IFS)
      IFS=$'\n' declare -a 'DIRS=($(compgen -d -- \"${SUBPATH}\"))'

      if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
        echo "Run (\$(compgen -d -- \"${SUBPATH}\"))" >> /tmp/lastcomplete
        echo "Moduledir: $PWD" >> /tmp/lastcomplete
        echo "Result: ${DIRS[@]}" >> /tmp/lastcomplete
        ls -l >> /tmp/lastcomplete
      fi
      popd > /dev/null
    fi

    for (( i=0; i<${#DIRS[@]}; i++ )); do
      # Filter out /. and /..
      DIR="${DIRS[i]}"
      if [[ "$DIR" =~ /\.\.?$ ]]; then
        continue
      fi

      # Add result (with prefix if applicable)
      COMPREPLY+=("$PREFIX$DIR/")
    done

    if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
      echo >> /tmp/lastcomplete
      echo "RESULT: ${COMPREPLY[@]}" >> /tmp/lastcomplete
    fi
  fi
}

_autocomplete_wh()
{
  local CUR PREFIX MATCH ISVALID

  COMPREPLY=()

  if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
    echo "WebHare wh autocomplete" > /tmp/lastcomplete
    set | grep ^COMP >> /tmp/lastcomplete
  fi

  # Default bash config splits on ':', so we need to merge them manually
  if [ "$COMP_CWORD" == "1" ]; then
    CUR="${COMP_WORDS[1]}"
    ISVALID=1
    if [[ "$CUR" == *":"* ]]; then
      # Mac bash doesn't split COMP_WORDS on ':', but does need the split for completions.
      PREFIX="${CUR%:*}:"
      CUR="${CUR:${#PREFIX}}"
    fi
  elif [ "$COMP_CWORD" == "2" -a "${COMP_WORDS[2]}" == ":" ]; then
    CUR=
    PREFIX="${COMP_WORDS[1]}${COMP_WORDS[2]}"
    ISVALID=1
  elif [ "$COMP_CWORD" == "3" -a "${COMP_WORDS[2]}" == ":" ]; then
    CUR="${COMP_WORDS[3]}"
    PREFIX="${COMP_WORDS[1]}${COMP_WORDS[2]}"
    if [[ $COMP_LINE == *${PREFIX}${CUR} ]]; then
      ISVALID=1
    fi
  fi

  if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
    echo "ISVALID: $ISVALID, prefix: '$PREFIX' cur: '$CUR' " > /tmp/lastcomplete
  fi

  if [ -n "$ISVALID" ]; then
    COMMANDS=`wh __listcommands`
    if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
      echo "Commands: ${COMMANDS}" >> /tmp/lastcomplete
    fi

    MATCHES=($(compgen -W "${COMMANDS}" -- "${PREFIX}${CUR}"))

    # Remove the prefix from the matches
    for MATCH in "${MATCHES[@]}"; do
      COMPREPLY+=("${MATCH:${#PREFIX}}")
    done

    if [ "$DEBUG_AUTOCOMPLETE" == "1" ]; then
      echo >> /tmp/lastcomplete
      echo "RESULT: ${COMPREPLY[@]}" >> /tmp/lastcomplete
    fi
  fi
}

complete -o filenames -o nospace -F _autocomplete_whcd whcd
complete -o default -F _autocomplete_wh wh
