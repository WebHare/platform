export function log(text: string) {
  /* FIXME
    var nodes = [ document.createTextNode(text), document.createElement("br") ];
    this.lastlognodes.push(nodes[0]);
    this.lastlognodes.push(nodes[1]);

    document.getElementById('logholder').appendChild(nodes[0]);
    document.getElementById('logholder').appendChild(nodes[1]);
    return nodes[0];
  */
  console.log("TESTFW log: " + text);
}
