/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { getTid } from "@webhare/gettid";
import "./video.css";
import "../internal/rtd.lang.json";
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler';


function createMyFrame() {
  const ifrm = document.createElement("iframe");
  ifrm.style.width = "100%";
  ifrm.style.height = "100%";
  ifrm.setAttribute("frameborder", 0);
  ifrm.setAttribute("allowfullscreen", "");

  /*
  Most browsers default to "strict-origin-when-cross-origin", but let's explicitly request it.
  (so video providers can only see from which website you view the video, not which specific page)
  Note that YouTube won't accept "no-referrer", it'll give an "YouTube Error 153" message.
  (this probably was enforced since juli 2025, error 153 appeared in the IFrame Player API documentation somewhere between 2 and 9 juli 2025)

  Also see:
  - https://developers.google.com/youtube/iframe_api_reference
  - https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity
  */
  ifrm.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

  // delegate autoplay (for Chrome) and fullscreen permission to the video player iframe
  // see: https://developer.chrome.com/blog/autoplay/#iframe_delegation
  ifrm.setAttribute("allow", "autoplay; fullscreen");

  return ifrm;
}

function initYouTube(node, video, playback) {
  const ifrm = createMyFrame();

  // List of embed parameters YouTube supports:
  // https://developers.google.com/youtube/player_parameters

  const youtubeUrl = new URL(`https://www.youtube.com/embed/${encodeURIComponent(video.id)}`);

  if (playback.autoplay)
    youtubeUrl.searchParams.set("autoplay", "1");

  if (video.mute || playback.mute)
    youtubeUrl.searchParams.set("mute", "1");

  if (video.starttime)
    youtubeUrl.searchParams.set("start", String(Math.floor(video.starttime))); // seconds, whole integer (YouTube also uses t= in the shorturl??)

  if (video.endtime)
    youtubeUrl.searchParams.set("end", String(Math.floor(video.endtime)));

  if (typeof playback.controls !== "undefined" && !playback.controls)
    youtubeUrl.searchParams.set("controls", "0");

  if (video.loop || playback.loop) {
    /* from the documentation: https://developers.google.com/youtube/player_parameters
       Note: This parameter has limited support in IFrame embeds. To loop a single video,
       set the loop parameter value to 1 and set the playlist parameter value to the
       same video ID already specified in the Player API URL:
       https://www.youtube.com/embed/VIDEO_ID?playlist=VIDEO_ID&loop=1
    */
    youtubeUrl.searchParams.set("loop", "1");
    youtubeUrl.searchParams.set("playlist", video.id);//To enable loop, set same video as playlist
  }

  youtubeUrl.searchParams.set("rel", "0"); // disable 'related video's'
  youtubeUrl.searchParams.set("enablejsapi", "1");
  youtubeUrl.searchParams.set("origin", location.origin);

  ifrm.src = youtubeUrl.toString();
  ifrm.title = video.title ? "YouTube video: " + video.title : "YouTube video";
  node.appendChild(ifrm);
}

function initVimeo(node, video, playback) {
  const ifrm = createMyFrame();

  // List of embed parameters Vimeo supports:
  // https://vimeo.zendesk.com/hc/en-us/articles/360001494447-Player-parameters-overview

  const vimeoUrl = new URL(`https://player.vimeo.com/video/${encodeURIComponent(video.id)}`);

  if (playback.autoplay)
    vimeoUrl.searchParams.set("autoplay", "1");

  if (video.mute || playback.mute)
    vimeoUrl.searchParams.set("muted", "1");

  if (video.endtime)
    console.warn("setting an endtime doesn't work for Vimeo video's");

  // NOTE: actually disabling controls is possible, but ONLY if the video is hosted by a Plus account or higher
  if (typeof playback.controls !== "undefined" && !playback.controls)
    console.warn("disabling video controls not possible for Vimeo video's");

  if (video.loop || playback.loop)
    vimeoUrl.searchParams.set("loop", "1");

  if (playback.background)
    vimeoUrl.searchParams.set("background", "1");

  if (playback.api) {
    vimeoUrl.searchParams.set("api", playback.api);

    // we need a player_id to distinguish from which iframe a message came.
    // (in cross domain situations we cannot lookup/compare the event source with iframe.contentWindow)
    if (playback.player_id)
      vimeoUrl.searchParams.set("player_id", playback.player_id);
  }

  if (video.starttime) {
    // #t=3m28s
    const t = video.starttime;
    const minutes = Math.floor(t / 60);
    const seconds = t % 60;
    vimeoUrl.hash = "#t=" + minutes + "m" + seconds + "s";
  }

  ifrm.src = vimeoUrl.toString();
  ifrm.title = video.title ? "Vimeo video: " + video.title : "Vimeo video";
  node.appendChild(ifrm);
}

function launchVideo(node, video, opts) {
  switch (video.network) {
    case 'youtube':
      initYouTube(node, video, opts || {});
      break;
    case 'vimeo':
      initVimeo(node, video, opts || {});
      break;
  }
}

function initializeVideoElementV1(node) {
  const video = JSON.parse(node.dataset.video);
  const opts = node.dataset.videoOptions ? JSON.parse(node.dataset.videoOptions) : {};
  node.innerHTML = '';
  launchVideo(node, video, opts);
}

function initializeVideoElementV2(node) {
  const video = JSON.parse(node.dataset.whVideo);

  const videonodes = dompack.qSA(node, ".wh-video--activate");

  for (const videonode of videonodes) {
    videonode.addEventListener("click", function () {
      activateVideo(videonode, video);
    });

    const playbutton = videonode.querySelector(".wh-video__playbutton");
    playbutton.setAttribute("tabindex", "0");
    playbutton.setAttribute("role", "button");
    playbutton.setAttribute("aria-label", getTid("publisher:site.rtd.embedvideo.playbutton-aria"));

    playbutton.addEventListener("click", function () {
      activateVideo(videonode, video, { autoplay: true });
    });

    // Because we don't use <button> we must implement it's keyboard interaction
    playbutton.addEventListener("keypress", function (evt) {
      // we are only interested in enter and space keypressed
      if (evt.keyCode !== 13 && evt.keyCode !== 32)
        return;

      // prevent other code getting the event or the space both triggering the video AND scrolling the page
      evt.preventDefault();

      activateVideo(videonode, video, { autoplay: true });
    });

    if (video.autoplay) //activate immediately
      if (node.dataset.whConsentRequired)
        consenthandler.onConsent(node.dataset.whConsentRequired, () => activateVideo(videonode, { ...video, mute: true }, { autoplay: true }));
      else
        activateVideo(videonode, { ...video, mute: true }, { autoplay: true });
  }
}

function activateVideo(videonode, video, opts) {
  if (videonode.__initialized)
    return;

  videonode.querySelector(".wh-video__innerframe__preview").hidden = true;
  videonode.__initialized = true;
  launchVideo(videonode, video, opts);
}

dompack.register('.wh-video', node => node.dataset.video ? initializeVideoElementV1(node) : initializeVideoElementV2(node));
