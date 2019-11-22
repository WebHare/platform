var tollium_domkey_map= { 'ESC': 'Escape'
                        , 'ENTER': 'Enter'
                        , 'LEFT': 'ArrowLeft'
                        , 'RIGHT': 'ArrowRight'
                        , 'UP': 'ArrowUp'
                        , 'DOWN': 'ArrowDown'
                        , 'TAB': 'Tab'
                        , 'DEL': 'Delete'
                        , 'END': 'End'
                        , 'HOME': 'Home'
                        , 'PGUP': 'PageUp'
                        , 'PGDN': 'PageDown'
                      };

export function getShortcutEvent(shortcut)
{
  if (shortcut && shortcut.keystr)
  {
    return (shortcut.alt ? "Alt+" : "")
        + (shortcut.ctrl ? "Control+" : "")
        + (shortcut.shift ? "Shift+" : "")
        + (tollium_domkey_map[shortcut.keystr] || shortcut.keystr);
  }
  return null;
}
