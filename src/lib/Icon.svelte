<script lang="ts">
  export let name: string;
  export let size = 16;
  export let fill = "none";

  // Çizgi ikonlar (24x24, çizgi kalınlığı 1.9)
  const P: Record<string, string> = {
    // yön / kontrol
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/>',
    prev: '<path d="M6 5v14"/><path d="M19 6v12L9 12z" fill="currentColor"/>',
    next: '<path d="M18 5v14"/><path d="M5 6v12l10-6z" fill="currentColor"/>',
    power: '<path d="M12 3v9"/><path d="M6.5 7a8 8 0 1 0 11 0"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    // gezinme
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14.5" r="1.2" fill="currentColor"/>',
    pencil: '<path d="M4 20h4L19.5 8.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    gear: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.3"/><path stroke-width="3.6" stroke-linecap="butt" d="M12 2.4v2.8M12 18.8v2.8M2.4 12h2.8M18.8 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M5.2 18.8l2-2M16.8 7.2l2-2"/>',
    pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 14v7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    drop: '<path d="M12 3.5s6 6.2 6 10.3a6 6 0 0 1-12 0c0-4.1 6-10.3 6-10.3z"/>',
    battery: '<rect x="3.5" y="8" width="15" height="9" rx="2.2"/><path d="M21 11v3"/><path d="M7 11.5v2"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6"/>',
    wave: '<path d="M4 10a11 11 0 0 1 16 0M7 13.5a7 7 0 0 1 10 0"/><circle cx="12" cy="17.5" r="1" fill="currentColor"/>',
    wind: '<path d="M4 9h10a2.5 2.5 0 1 0-2.5-2.5M4 14h13a2.5 2.5 0 1 1-2.5 2.5M4 19h6"/>',
    door: '<path d="M7 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15"/><path d="M5 20h14"/><circle cx="14" cy="12.5" r=".8" fill="currentColor"/>',
    grip: '<circle cx="9" cy="6.5" r="1.2" fill="currentColor"/><circle cx="15" cy="6.5" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17.5" r="1.2" fill="currentColor"/><circle cx="15" cy="17.5" r="1.2" fill="currentColor"/>',
    expand: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    shrink: '<path d="M3.5 12h6M20.5 12h-6M7 9l3 3-3 3M17 9l-3 3 3 3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    ram: '<rect x="3" y="7.5" width="18" height="8" rx="1.6"/><path d="M7 15.5V18M11 15.5V18M15 15.5V18M7 10.5v2M11 10.5v2M15 10.5v2"/>',
    disk: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
    net: '<path d="M8 4v14M4.5 14.5L8 18l3.5-3.5M16 20V6M12.5 9.5L16 6l3.5 3.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    // varlık türleri
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
    toggle: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.2" fill="currentColor"/>',
    fan: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2c-1.2-3.4-.6-6 1.6-6.2 2 0 2.6 2.2 1.2 4.2-.5.8-1.6 1.6-2.8 2z"/><path d="M13.6 12.9c3.4.4 5.6 2 5.2 4.1-.4 2-2.7 2.1-4.4.4-.7-.7-1.2-1.9-1.2-3.2z"/><path d="M10.4 13.1c-2.8 2-5.5 2-6.4.1-.8-1.8.9-3.2 3-2.9.9.1 2.1.8 3.4 2.8z"/>',
    blinds: '<path d="M5 4h14v16H5z"/><path d="M5 9h14M5 14h14"/><path d="M12 14v4"/>',
    lock: '<rect x="5.5" y="11" width="13" height="9" rx="2.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
    thermo: '<path d="M10 14.4V5.5a2 2 0 0 1 4 0v8.9a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
    speaker: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    scene: '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    script: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M10.5 9l4 3-4 3z" fill="currentColor"/>',
    auto: '<path d="M13 3L5.5 13H11l-1 8L18.5 10H13z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".8" fill="currentColor"/><circle cx="4.8" cy="12" r=".8" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".8" fill="currentColor"/>',
    button: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.8 6.8a7.3 7.3 0 0 0 0 10.4M17.2 6.8a7.3 7.3 0 0 1 0 10.4"/>',
  };
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  {fill}
  stroke="currentColor"
  stroke-width="1.9"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>{@html P[name] ?? ""}</svg>
