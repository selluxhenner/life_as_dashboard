import { migrate } from './db.js';
import { seedFeeds } from './lib/feeds.js';

const applied = migrate();
seedFeeds();
console.log(applied.length ? 'applied: ' + applied.join(', ') : 'database is up to date');
