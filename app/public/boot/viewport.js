// An iPhone zooms the page into any field whose text is under 16px, and most
// of ours are. maximum-scale=1 stops that; iOS still lets a pinch zoom past
// it, so nothing is lost there. Android would honour it and lose pinch-zoom,
// so it is added on iPhone and iPad only.
//
// A file rather than an inline script so the Content-Security-Policy can
// refuse every inline script (staticwebapp.config.json).
if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.querySelector('meta[name="viewport"]').content += ', maximum-scale=1';
}
