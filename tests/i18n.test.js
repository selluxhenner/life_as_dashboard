// The UI is English. German may only appear in migration code (old data it recognises), capture and goal-count parsing and voice language detection (German input it recognises) and region names.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOW = ['core/migrations.js', 'core/goals.js', 'features/capture/captures.js', 'voice/tts.js'];
const GERMAN = /[äöüÄÖÜß]|\b(Heute|Woche|Ziele|Bewerbung|Hinzufügen|erledigt|Tagesplan|Speichern|Verbinden|Schliessen|Nächster|offen)\b/;

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(js|css|html)$/.test(f) ? [p] : [];
  });
}

describe('no German UI strings', () => {
  it('src/ is English outside allowed files', () => {
    const offenders = [];
    for (const f of files('src')) {
      if (ALLOW.some(a => f.split('\\').join('/').endsWith(a))) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (GERMAN.test(line) && !/Côte|Werkstudent|tag(es)?abrechnung/i.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
