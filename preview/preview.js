if (matchMedia('(max-width:520px)').matches) {
  location.replace(new URL('./app/', location.href));
} else {
  const frame = document.querySelector('iframe[data-src]');
  frame.src = frame.dataset.src;
}
