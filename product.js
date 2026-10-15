// Product page only: the image gallery — thumbnails, arrows and arrow keys,
// all driving the same index so they stay in step.

const pdpGrid = document.querySelector('.pdp-grid');
if (pdpGrid) {
  const photo  = document.getElementById('pdp-photo');
  const thumbs = Array.from(document.querySelectorAll('.pdp-thumb'));
  const images = JSON.parse(pdpGrid.getAttribute('data-gallery') || '[]');

  const FADE_MS = 160;   // keep in step with the .pdp-photo transition
  let index = 0;
  let swapTimer = null;

  function show(i) {
    if (!images.length) return;
    const target = (i + images.length) % images.length;
    if (target === index && photo.getAttribute('src') === images[index]) return;
    index = target;

    // The thumbnail responds at once — only the photo waits for the fade.
    thumbs.forEach(t => t.classList.toggle('active',
      Number(t.getAttribute('data-index')) === index));

    // Decode the next image up front so the swap can't show a blank frame.
    const next = new Image();
    next.src = images[index];

    const apply = () => {
      photo.src = images[index];
      requestAnimationFrame(() => photo.classList.remove('is-fading'));
    };

    clearTimeout(swapTimer);
    photo.classList.add('is-fading');
    swapTimer = setTimeout(() => {
      if (next.complete) apply();
      else { next.onload = apply; next.onerror = apply; }
    }, FADE_MS);
  }

  thumbs.forEach(btn => {
    btn.addEventListener('click', () => show(Number(btn.getAttribute('data-index'))));
  });

  const prev = document.getElementById('pdp-prev');
  const next = document.getElementById('pdp-next');
  if (prev) prev.addEventListener('click', () => show(index - 1));
  if (next) next.addEventListener('click', () => show(index + 1));

  document.addEventListener('keydown', (e) => {
    if (images.length < 2) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
}
