export function addPixel(account, url)
{
  let el = document.createElement('iframe');
  el.src='/.socialite/pixels/facebook/!/' + account + '/' + url;
  el.style.width='1px';
  el.style.height='1px';
  el.style.visiblity='hidden';
  el.style.position='absolute';
  el.style.left='-100vw';
  el.style.top='0';
  el.style.border='none';
  el.frameBorder=0;
  document.body.appendChild(el);
}
