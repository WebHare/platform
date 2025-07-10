/* Identify devices for the purpose of analytics/tracing
   NOT a library for feature detection!
   Originally based on Mootools.Browser
*/

export type Platform = "windows" | "ios" | "webos" | "android" | "linux" | "mac" | "other";
export type Device = "desktop" | "mobile" | "tablet" | "";

/** Valid KeyboardEvent.key values (next to 'plain' keys)
    This list was built from https://www.w3.org/TR/uievents-key/
    using `console.log([...new Set([...document.querySelectorAll(".key-table-key .key")].map(_ => _.textContent))].toSorted().join(' | '))`
*/
export type KeyAttributeValue = "AVRInput" | "AVRPower" | "Accept" | "Again" | "AllCandidates" | "Alphanumeric" | "Alt" | "AltGraph" | "AppSwitch" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "Attn" | "AudioBalanceLeft" | "AudioBalanceRight" | "AudioBassBoostDown" | "AudioBassBoostToggle" | "AudioBassBoostUp" | "AudioFaderFront" | "AudioFaderRear" | "AudioSurroundModeNext" | "AudioTrebleDown" | "AudioTrebleUp" | "AudioVolumeDown" | "AudioVolumeMute" | "AudioVolumeUp" | "Backspace" | "BrightnessDown" | "BrightnessUp" | "BrowserBack" | "BrowserFavorites" | "BrowserForward" | "BrowserHome" | "BrowserRefresh" | "BrowserSearch" | "BrowserStop" | "Call" | "Camera" | "CameraFocus" | "Cancel" | "CapsLock" | "ChannelDown" | "ChannelUp" | "Clear" | "Close" | "ClosedCaptionToggle" | "CodeInput" | "ColorF0Red" | "ColorF1Green" | "ColorF2Yellow" | "ColorF3Blue" | "ColorF4Grey" | "ColorF5Brown" | "Compose" | "ContextMenu" | "Control" | "Convert" | "Copy" | "CrSel" | "Cut" | "DVR" | "Dead" | "Delete" | "Dimmer" | "DisplaySwap" | "Eisu" | "Eject" | "End" | "EndCall" | "Enter" | "EraseEof" | "Escape" | "ExSel" | "Execute" | "Exit" | "F1" | "F10" | "F11" | "F12" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "FavoriteClear0" | "FavoriteClear1" | "FavoriteClear2" | "FavoriteClear3" | "FavoriteRecall0" | "FavoriteRecall1" | "FavoriteRecall2" | "FavoriteRecall3" | "FavoriteStore0" | "FavoriteStore1" | "FavoriteStore2" | "FavoriteStore3" | "FinalMode" | "Find" | "Fn" | "FnLock" | "GoBack" | "GoHome" | "GroupFirst" | "GroupLast" | "GroupNext" | "GroupPrevious" | "Guide" | "GuideNextDay" | "GuidePreviousDay" | "HangulMode" | "HanjaMode" | "Hankaku" | "HeadsetHook" | "Help" | "Hibernate" | "Hiragana" | "HiraganaKatakana" | "Home" | "Hyper" | "Info" | "Insert" | "InstantReplay" | "JunjaMode" | "KanaMode" | "KanjiMode" | "Katakana" | "Key11" | "Key12" | "LastNumberRedial" | "LaunchApplication1" | "LaunchApplication2" | "LaunchCalendar" | "LaunchContacts" | "LaunchMail" | "LaunchMediaPlayer" | "LaunchMusicPlayer" | "LaunchPhone" | "LaunchScreenSaver" | "LaunchSpreadsheet" | "LaunchWebBrowser" | "LaunchWebCam" | "LaunchWordProcessor" | "Link" | "ListProgram" | "LiveContent" | "Lock" | "LogOff" | "MailForward" | "MailReply" | "MailSend" | "MannerMode" | "MediaApps" | "MediaAudioTrack" | "MediaClose" | "MediaFastForward" | "MediaLast" | "MediaNextTrack" | "MediaPause" | "MediaPlay" | "MediaPlayPause" | "MediaPreviousTrack" | "MediaRecord" | "MediaRewind" | "MediaSkipBackward" | "MediaSkipForward" | "MediaStepBackward" | "MediaStepForward" | "MediaStop" | "MediaTopMenu" | "MediaTrackNext" | "MediaTrackPrevious" | "Meta" | "MicrophoneToggle" | "MicrophoneVolumeDown" | "MicrophoneVolumeMute" | "MicrophoneVolumeUp" | "ModeChange" | "NavigateIn" | "NavigateNext" | "NavigateOut" | "NavigatePrevious" | "New" | "NextCandidate" | "NextFavoriteChannel" | "NextUserProfile" | "NonConvert" | "Notification" | "NumLock" | "OnDemand" | "Open" | "PageDown" | "PageUp" | "Pairing" | "Paste" | "Pause" | "PinPDown" | "PinPMove" | "PinPToggle" | "PinPUp" | "Play" | "PlaySpeedDown" | "PlaySpeedReset" | "PlaySpeedUp" | "Power" | "PowerOff" | "PreviousCandidate" | "Print" | "PrintScreen" | "Process" | "Props" | "RandomToggle" | "RcLowBattery" | "RecordSpeedNext" | "Redo" | "RfBypass" | "Romaji" | "STBInput" | "STBPower" | "Save" | "ScanChannelsToggle" | "ScreenModeNext" | "ScrollLock" | "Select" | "Settings" | "Shift" | "SingleCandidate" | "Soft1" | "Soft2" | "Soft3" | "Soft4" | "SpeechCorrectionList" | "SpeechInputToggle" | "SpellCheck" | "SplitScreenToggle" | "Standby" | "Subtitle" | "Super" | "Symbol" | "SymbolLock" | "TV" | "TV3DMode" | "TVAntennaCable" | "TVAudioDescription" | "TVAudioDescriptionMixDown" | "TVAudioDescriptionMixUp" | "TVContentsMenu" | "TVDataService" | "TVInput" | "TVInputComponent1" | "TVInputComponent2" | "TVInputComposite1" | "TVInputComposite2" | "TVInputHDMI1" | "TVInputHDMI2" | "TVInputHDMI3" | "TVInputHDMI4" | "TVInputVGA1" | "TVMediaContext" | "TVNetwork" | "TVNumberEntry" | "TVPower" | "TVRadioService" | "TVSatellite" | "TVSatelliteBS" | "TVSatelliteCS" | "TVSatelliteToggle" | "TVTerrestrialAnalog" | "TVTerrestrialDigital" | "TVTimer" | "Tab" | "Teletext" | "Undo" | "Unidentified" | "VideoModeNext" | "VoiceDial" | "WakeUp" | "Wink" | "Zenkaku" | "ZenkakuHankaku" | "ZoomIn" | "ZoomOut" | "ZoomToggle";

export type UserAgentInfo =
  {
    /** Browser name, eg 'chrome' or 'firefox' */
    name: string;
    /** Browser numeric version (eg 97) */
    version: number;
    /** Platform the browser is running on (eg 'windows') */
    platform: Platform;
    /** Type of device (eg 'desktop' or 'tablet' for an iPad) */
    device: Device;
    /** platform-browsername-version eg ios-safari-11 */
    triplet: string;
  };

export function parseUserAgent(ua: string): UserAgentInfo {
  ua = ua.toLowerCase();

  // chrome is included in the edge UA, so need to check for edge first, before checking if it's chrome.
  // safari is included in the miuibrowser UA, so need to check for miuibrowser first, before checking if it's safari.
  let UA: RegExpMatchArray | null = ua.match(/(edge|miuibrowser)[\s/:]([\w\d.]+)/);
  if (!UA)
    UA = ua.match(/(opera|ie|firefox|chrome|trident|crios|version)[\s/:]([\w\d.]+)?.*?(safari|(?:rv[\s/:]|version[\s/:])([\w\d.]+)|$)/);
  if (!UA) { //try ios 11.4.1
    UA = ua.match(/; cpu os ([\d]+)/);
    if (UA)
      UA = ['', 'safari', UA[1]];
  }
  if (!UA)
    UA = ['', 'unknown', "0"];

  if (UA[1] === 'trident') {
    UA[1] = 'ie';
    if (UA[4]) UA[2] = UA[4];
  } else if (UA[1] === 'crios') {
    UA[1] = 'chrome';
  }

  let platform = ua.match(/ip(?:ad|od|hone)/) ? 'ios' : (ua.match(/(?:webos|android)/) || ua.match(/mac|win|linux/) || ['other'])[0];
  if (platform === 'win')
    platform = 'windows';

  const name = (UA[1] === 'version') ? UA[3] : UA[1];
  const version = parseInt((UA[1] === 'opera' && UA[4]) ? UA[4] : UA[2]);
  const device = ua.match(/ipad/) ? 'tablet' : ['ios', 'webos', 'android'].includes(platform) ? 'mobile' : ['mac', 'windows', 'linux'].includes(platform) ? 'desktop' : '';

  return {
    name,
    version,
    platform: platform as Platform,
    device,
    triplet: platform + '-' + name + '-' + version
  };
}

/**
 * Is the native 'multiselect' modifier for this platform pressed? (Cmd for Mac, Ctrl for Windows/Linux)
 *
 * @param event - Event to check
 */
export function isMultiSelectKey(event: KeyboardEvent | MouseEvent): boolean {
  return browser.platform === 'mac' ? event.metaKey : event.ctrlKey;
}

/**
 * Is the native 'copy' modifier for this platform pressed?
 *
 * @param event - Event to check
 */
export function isCopyKey(event: KeyboardEvent | MouseEvent): boolean {
  return browser.platform === 'mac' ? event.altKey : event.ctrlKey;
}

/** @deprecated Use getBrowser() instead, available since WH5.6.3. We will remove `browser` in the future to improve tree shaking */
export const browser: Readonly<UserAgentInfo> = Object.freeze(parseUserAgent(globalThis.navigator?.userAgent || ""));

/** Get browser information */
export function getBrowser(): Readonly<UserAgentInfo> {
  //Offer this as a function to improve treeshakability
  return browser;
}

//CSS Query used to find valid submittors
export const submitselector = 'input[type=submit],input[type=image],button[type=submit],button:not([type])';
//Must match possible types returned by the submitselector
export type SubmitSelectorType = HTMLInputElement | HTMLButtonElement;
