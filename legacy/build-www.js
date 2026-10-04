// Copies the static dashboard files into www/, which Capacitor bundles into the app.
const fs = require('fs');
const path = require('path');

const files = ['index.html', 'app.js', 'styles.css', 'manifest.json', 'icon.svg', 'sw.js'];
const out = path.join(__dirname, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(__dirname, file), path.join(out, file));
}
console.log('www/ built (' + files.length + ' files)');
