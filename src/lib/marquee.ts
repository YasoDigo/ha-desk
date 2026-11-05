// Sığmayan metin: kutucuğun üstüne gelince yazı yana kayar.
// Kullanım: <span class="mq" use:marquee={text}><span class="mi">{text}</span></span>
export function marquee(node: HTMLElement, _text?: unknown) {
  const inner = node.firstElementChild as HTMLElement | null;
  const host = (node.closest(".tile, .stile") as HTMLElement | null) ?? node;
  let delta = 0;

  const measure = () => {
    if (!inner) return;
    delta = Math.max(0, inner.scrollWidth - node.clientWidth);
    node.classList.toggle("clip", delta > 2);
  };
  const enter = () => {
    measure();
    if (!inner || delta <= 2) return;
    inner.style.transition = `transform ${Math.max(0.8, delta / 40)}s linear 0.2s`;
    inner.style.transform = `translateX(${-delta}px)`;
  };
  const leave = () => {
    if (!inner) return;
    inner.style.transition = "transform 0.25s ease";
    inner.style.transform = "";
  };

  host.addEventListener("pointerenter", enter);
  host.addEventListener("pointerleave", leave);
  requestAnimationFrame(measure);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  ro?.observe(node);

  return {
    update() {
      requestAnimationFrame(measure);
    },
    destroy() {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      ro?.disconnect();
    },
  };
}
