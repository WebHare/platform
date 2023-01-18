export function isLike(text: string, mask: string): boolean {
  mask = mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  mask = mask.replaceAll("\\*", ".*");
  mask = mask.replaceAll("\\?", ".");
  return new RegExp(mask).test(text);
}

export function isNotLike(text: string, mask: string): boolean {
  return !isLike(text, mask);
}
