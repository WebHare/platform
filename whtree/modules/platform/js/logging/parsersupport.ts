/** Based on https://www.npmjs.com/package/ip6, created by elgs on 3/5/16.*/
function normalizeIP6(a: string) {
  a = a.toLowerCase();

  const nh = a.split(/::/g);
  if (nh.length > 2) {
    throw new Error('Invalid address: ' + a);
  }

  let sections: string[] = [];
  if (nh.length === 1) {
    // full mode
    sections = a.split(':');
    if (sections.length !== 8) {
      throw new Error('Invalid address: ' + a);
    }
  } else if (nh.length === 2) {
    // compact mode
    sections.push(...nh[0].split(':'));
    const h = nh[1];
    const hs = h.split(':');
    for (let i = hs.length; i > 0; --i) {
      sections[7 - (hs.length - i)] = hs[i - 1];
    }
  }
  for (let i = 0; i < 8; ++i) {
    if (sections[i] === undefined) {
      sections[i] = '0000';
    }
    sections[i] = sections[i].padStart(4, '0');
  }
  return sections.join(':');
};

function abbreviateIP6(a: string) {
  a = normalizeIP6(a);
  a = a.replace(/0000/g, 'g');
  a = a.replace(/:000/g, ':');
  a = a.replace(/:00/g, ':');
  a = a.replace(/:0/g, ':');
  a = a.replace(/g/g, '0');
  // remove leading zeros of a
  a = a.replace(/^0+/, '');
  const sections = a.split(/:/g);
  let zPreviousFlag = false;
  let zeroStartIndex = -1;
  let zeroLength = 0;
  let zStartIndex = -1;
  let zLength = 0;
  for (let i = 0; i < 8; ++i) {
    const section = sections[i];
    const zFlag = (section === '0');
    if (zFlag && !zPreviousFlag) {
      zStartIndex = i;
    }
    if (!zFlag && zPreviousFlag) {
      zLength = i - zStartIndex;
    }
    if (zLength > 1 && zLength > zeroLength) {
      zeroStartIndex = zStartIndex;
      zeroLength = zLength;
    }
    zPreviousFlag = (section === '0');
  }
  if (zPreviousFlag) {
    zLength = 8 - zStartIndex;
  }
  if (zLength > 1 && zLength > zeroLength) {
    zeroStartIndex = zStartIndex;
    zeroLength = zLength;
  }

  if (zeroStartIndex >= 0 && zeroLength > 1) {
    sections.splice(zeroStartIndex, zeroLength, 'g');
  }
  a = sections.join(':');

  a = a.replace(/:g:/g, '::');
  a = a.replace(/:g/g, '::');
  a = a.replace(/g:/g, '::');
  a = a.replace(/g/g, '::');

  return a;
}

/** Anonymize IP address for further analytics processing (based on https://support.google.com/analytics/answer/2763052)

For example, an IP address of 12.214.31.144 would be changed to 12.214.31.0.
If the IP address is an IPv6 address, the last 80 of the 128 bits are set to zero.

@param address - IP Address to anonymize
@returns IP address truncated to signifcant 24 bits (IPv4) or 80 bits (IPv6)
*/
export function anonymizeIPAddress(address: string): string {
  if (address.includes(':')) {
    //to get 48 bits: take the first 3 parts (16 bits per part), which works out to be 3*4 + 2 (colons) bytes
    return abbreviateIP6(normalizeIP6(address).slice(0, 3 * 4 + 2) + '::');
  } else {
    return address.split('.').slice(0, 3).join('.') + '.0';
  }
}
