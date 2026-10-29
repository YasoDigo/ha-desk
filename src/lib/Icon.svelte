<script lang="ts">
  export let name: string;
  export let size = 16;

  // Basit çizgi ikonlar (24x24)
  const P: Record<string, string> = {
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
  };
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>{@html P[name] ?? ""}</svg>
