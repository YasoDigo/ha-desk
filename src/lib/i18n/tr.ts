// Ana dil (Türkçe). Yeni metin eklerken önce buraya anahtar yazılır, sonra en.ts'e çevirisi eklenir.
export const tr = {
  "tab.connection": "Bağlantı",
  "tab.general": "Genel",
  "tab.shortcuts": "Kısayollar",
  "tab.notifications": "Bildirimler",
  "tab.backup": "Yedek",

  "conn.primary": "Birincil adres",
  "conn.fallback": "Yedek adres (isteğe bağlı)",
  "conn.fallbackPh": "Birincil açılmazsa denenir",
  "conn.token": "Erişim token'ı",
  "conn.tokenSaved": "Kayıtlı. Değiştirmek için yaz",
  "conn.tokenPh": "Long-lived access token",
  "conn.saveConnect": "Kaydet ve bağlan",
  "conn.deleteToken": "Token'ı sil",
  "conn.status": "Durum: {status}",

  "general.theme": "Tema",
  "theme.dark": "Koyu",
  "theme.light": "Açık",
  "theme.system": "Sistem",
  "general.accent": "Vurgu rengi",
  "general.autostart": "Windows ile başlat (tray'de gizli açılır)",
  "general.paletteSensors": "Komut paletinde sensörleri de ara (grafik için → tuşu)",
  "general.language": "Dil",
  "lang.auto": "Sistem dili",
} satisfies Record<string, string>;

export type Key = keyof typeof tr;
