// Builds and opens the installer design preview (src-tauri/installer/preview/preview.nsi): every page of the real
// installer with a simulated install, so the design can be checked without installing anything.
//   npm run installer:preview               the installer
//   npm run installer:preview -- --uninstall  the uninstaller (run the installer preview to the end once first)
//   npm run installer:preview -- --art        re-render the artwork first (needs Python with Pillow)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const makensis = join(process.env.LOCALAPPDATA || '', 'tauri', 'NSIS', 'makensis.exe');
if (!existsSync(makensis)) {
  console.error('makensis not found. Run `npm run desktop:build` once: Tauri downloads NSIS into %LOCALAPPDATA%\\tauri\\NSIS.');
  process.exit(1);
}
if (args.includes('--art')) execFileSync('python', [join(root, 'src-tauri/installer/art/make_art.py')], { stdio: 'inherit' });

const { version } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
execFileSync(makensis, ['/V2', `/DVERSION=${version}`, 'preview.nsi'], { cwd: join(root, 'src-tauri/installer/preview'), stdio: 'inherit' });

const temp = process.env.TEMP;
const exe = args.includes('--uninstall')
  ? join(temp, 'agentic-os-installer-preview', 'uninstall-preview.exe')
  : join(temp, 'agentic-os-installer-preview.exe');
if (!existsSync(exe)) { console.error('Not found: ' + exe + ' (run the installer preview to the end first)'); process.exit(1); }
spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
console.log('Opened ' + exe);
