import * as dompack from 'dompack';
require('./video.css');

let youtubedomain = 'www.youtube.com';

function createMyFrame()
{
  let ifrm = document.createElement("iframe");
  ifrm.style.width = "100%";
  ifrm.style.height = "100%";
  ifrm.setAttribute("frameborder", 0);
  ifrm.setAttribute("allowfullscreen", "");
  return ifrm;
}

function initYouTube(node, video, playback)
{
  let ifrm = createMyFrame();
  // https://developers.google.com/youtube/player_parameters
  var args = [];

  if(playback.autoplay)
    args.push("autoplay=1");

  if(playback.mute)
    args.push("mute=1");

  if (video.starttime)
    args.push("start="+Math.floor(video.starttime)); // seconds, whole integer (YouTube also uses t= in the shorturl??)

  if (video.endtime)
    args.push("end="+Math.floor(video.endtime));

  if (typeof playback.controls != "undefined" && !playback.controls)
    args.push("controls=0");

  if (playback.loop)
  {
    /* from the documentation: https://developers.google.com/youtube/player_parameters
        Note: This parameter has limited support in the AS3 player and in IFrame embeds, which could load either
        the AS3 or HTML5 player. Currently, the loop parameter only works in the AS3 player when used
        in conjunction with the playlist parameter. To loop a single video, set the loop parameter value to 1
        and set the playlist parameter value to the same video ID already specified in the Player API URL
    */
    args.push("loop=1", "playlist=" + video.id);//To enable loop, set same video as playlist
  }

  args.push("rel=0", "enablejsapi=1", "origin=" + location.origin); // disable 'related video's'

  // ADDME: playsinline parameter for inline or fullscreen playback on iOS
  /*
  YouTube
  -   start=
    & end=
    & controls=0

    & modestbranding=0
    & rel=0
    & showinfo=0
  */

  var youtube_url = `//${youtubedomain}/embed/${video.id}`;
  if (args.length > 0)
    youtube_url += "?" + args.join("&");

  ifrm.src = youtube_url;
  node.appendChild(ifrm);
}

function initVimeo(node,video, playback)
{
  let ifrm = createMyFrame();
  var args = [];

  if(playback.autoplay)
    args.push("autoplay=1");

  if (video.endtime)
    console.warn("setting an endtime doesn't work for Vimeo video's");

  if (typeof playback.controls != "undefined" && !playback.controls)
    console.warn("disabling video controls not possible for Vimeo video's");

  if (playback.loop)
    args.push("loop=1");

  if (playback.background)
    args.push("background=1");

  if(playback.api)
  {
    args.push("api=" + playback.api);

    // we need a player_id to distinguish from which iframe a message came.
    // (in cross domain situations we cannot lookup/compare the event source with iframe.contentWindow)
    if(playback.player_id)
      args.push("player_id=" + playback.player_id );
  }

  var vimeo_url = "//player.vimeo.com/video/" + video.id;
  if (args.length > 0)
    vimeo_url += "?" + args.join("&");

  if (video.starttime)
  {
    // #t=3m28s
    var t = video.starttime;
    var minutes = Math.floor(t / 60);
    var seconds = t % 60;
    vimeo_url += "#t=" + minutes + "m" + seconds + "s";
  }

  ifrm.src = vimeo_url;
  node.appendChild(ifrm);
}

function launchVideo(node, video, opts)
{
  switch(video.network)
  {
    case 'youtube':
      initYouTube(node,video,opts);
      break;
    case 'vimeo':
      initVimeo(node,video,opts);
      break;
  }
}

function initializeVideoElementV1(node)
{
  let video = JSON.parse(node.dataset.video);
  let opts = node.dataset.videoOptions ? JSON.parse(node.dataset.videoOptions) : {};
  node.innerHTML='';
  launchVideo(node, video, opts);
}

function initializeVideoElementV2(node)
{
  let video = JSON.parse(node.dataset.whVideo);
  let opts = node.dataset.whVideoOptions ? JSON.parse(node.dataset.whVideoOptions) : {};
  opts.autoplay=true;

  dompack.qSA(node, ".wh-video--activate").forEach(el => el.addEventListener("click", function()
  {
    node.querySelector(".wh-video__innerframe__preview").hidden = true;
    launchVideo(el, video, opts);
  }));
}

dompack.register('.wh-video', node => node.dataset.video ? initializeVideoElementV1(node) : initializeVideoElementV2(node));
