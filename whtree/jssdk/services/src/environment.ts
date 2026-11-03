export function getBasePort() {
  if (!process.env.WEBHARE_BASEPORT)
    throw new Error("WEBHARE_BASEPORT not set in environment");

  const port = parseInt(process.env.WEBHARE_BASEPORT, 10);
  if (port < 1024 || port > 65500)
    throw new Error(`Invalid WEBHARE_BASEPORT '${process.env.WEBHARE_BASEPORT}'`);

  return port;
}
