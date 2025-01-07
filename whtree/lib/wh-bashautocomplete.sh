#!/bin/bash
# WH autocomplete file

complete -o filenames -o nospace -C "wh __autocomplete_whcd" whcd
complete -o default -o nospace -C "wh __autocomplete_wh" wh
