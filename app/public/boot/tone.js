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
  var tone = starts(['/social', '/messages']) ? ['social', '#FF3471']
    : starts(['/services', '/forwarders', '/community-service', '/packing']) ? ['services', '#3A8C4E']
    : starts(['/shop', '/sell', '/lots', '/lot/', '/routes']) ? ['sell', '#177ACE']
    : ['buy', '#5B5EF1'];
  if (path.indexOf('/social/f/') === 0) tone[1] = '#C627CB';
  document.documentElement.setAttribute('data-tone', tone[0]);
  document.querySelector('meta[name="theme-color"]').content = tone[1];
})();
