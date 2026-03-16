export const isLight = (hex: string): boolean => {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 155;
};

export const darken = (hex: string, amount = 0.45): string => {
  if (!hex || hex.length < 7) return "#666";
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amount));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amount));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amount));
  return `rgb(${r},${g},${b})`;
};

/** display color: dark text color for light backgrounds, original for dark */
export const dc = (hex: string): string => (isLight(hex) ? darken(hex, 0.35) : hex);

export const parseRanked = (label: string): number => {
  const m = label.match(/TOP\s*(\d+)/i);
  return m ? parseInt(m[1]) : 0;
};
