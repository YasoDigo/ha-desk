// Verilen arka plan rengi üstünde okunaklı yazı rengi (koyu ya da beyaz) seçer.
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function inkFor(rgb: number[]): string {
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.179 ? "#1b1608" : "#ffffff"; // 0.179: siyah ve beyazın eşit kontrast verdiği eşik
}

export function hexToRgb(hex: string): number[] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
