// Pages that open from the corner menu (the Settings button at the bottom of the rail):
// Lina's setup (wake word, quick answers, vault, people, voice) and the connectors (Google, Slack, Fuxam).
// The panels themselves live in settings.js; these pages only give them their own place.
import { h } from '../core/dom.js';
import { viewHead } from '../components/ui.js';
import { linaPanel, voicePanel, connectionsPanel } from './settings.js';

export const linaSetup = {
  id: 'lina-setup',
  render(root) {
    root.append(h('div.view.settings',
      viewHead('Lina setup', '“Hey Lina”, quick answers, the Obsidian vault, the people she knows, and her voice.'),
      h('div.grid.g-2', h('div.stack', linaPanel()), h('div.stack', voicePanel()))));
  }
};

export const connectors = {
  id: 'connectors',
  render(root) {
    root.append(h('div.view.settings',
      viewHead('Connectors', 'Google Calendar and Gmail, Slack and the Fuxam school calendar. They are connected on the server, so every device sees them.'),
      h('div.grid.g-2', h('div.stack', connectionsPanel()))));
  }
};
