export function getRescueOrigin()
{
  const rescueip = process.env["WEBHARE_RESCUEPORT_BINDIP"] || "127.0.0.1";
  const rescueport = process.env["WEBHARE_BASEPORT"] || "13679";
  return `http://${rescueip}:${rescueport}`;
}

