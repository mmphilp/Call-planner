/** Common surgical abbreviations, used when a service has no calendar label of its own. */
const KNOWN: [RegExp, string][] = [
  [/colorectal/i, 'CRS'],
  [/surgical onc/i, 'Surg Onc'],
];

/**
 * The label a service gets when its calendar label is blank:
 * "Colorectal" → "CRS"; "Surgical Oncology" → "Surg Onc";
 * "Minimally Invasive Surgery" → "MIS"; "Endocrine Surgery" → "Endocrine".
 */
export function autoLabel(name: string) {
  const known = KNOWN.find(([re]) => re.test(name));
  if (known) return known[1];
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 3 ? words.map((w) => w[0].toUpperCase()).join('') : words[0] ?? name;
}

/** The short label shown on calendars. */
export const serviceLabel = (s: { name: string; shortName?: string }) => s.shortName?.trim() || autoLabel(s.name);
