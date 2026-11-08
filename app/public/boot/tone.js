// The section's colour before the first paint. Safari takes its status bar
// colour from the first frame, so waiting for the app to load and set it left
// every section in Buy's. Keep in step with TONES in src/AppShell.tsx and the
// tabs' paths in src/components/TabBar.tsx.
//
// A file rather than an inline script so the Content-Security-Policy can
// refuse every inline script (staticwebapp.config.json).
(function () {
  var path = location.pathname;
  var starts = function (list) { return list.some(function (p) { return path.indexOf(p) === 0; }); };
  var tone = starts(['/social', '/messages']) ? ['social', '#1A1A19']
    : starts(['/services', '/forwarders', '/community-service', '/packing']) ? ['services', '#1A1A19']
    : starts(['/shop', '/sell', '/lots', '/lot/', '/routes']) ? ['sell', '#1A1A19']
    : starts(['/discover']) ? ['discover', '#1A1A19']
    : starts(['/quests']) ? ['quests', '#1A1A19']
    : ['buy', '#1A1A19'];
  if (path.indexOf('/social/f/') === 0) tone[1] = '#1A1A19';
  document.documentElement.setAttribute('data-tone', tone[0]);
  document.querySelector('meta[name="theme-color"]').content = tone[1];
})();

// The reader's text size, before the first paint, so nothing reflows when the
// app arrives. Keep in step with src/textSize.ts.
(function () {
  try {
    var size = localStorage.getItem('figmark:text-size');
    if (size === 'large' || size === 'larger') document.documentElement.setAttribute('data-text-size', size);
  } catch (e) { /* Storage refused: default size. */ }
})();

// The theme, before the first paint, so a light screen never flashes dark.
// Keep in step with src/theme.ts.
(function () {
  var choice = 'auto';
  try {
    var stored = localStorage.getItem('figmark:theme');
    if (stored === 'light' || stored === 'dark') choice = stored;
  } catch (e) { /* Storage refused: follow the device. */ }
  var light = choice === 'light' || (choice === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme-choice', choice);
  if (light) document.querySelector('meta[name="theme-color"]').content = '#F2F0EA';
})();
