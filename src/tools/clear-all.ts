// Clear the draft backlog — archives every active draft so the next scan starts
// from a clean slate. Backs the `/linkedin-engage clear` step and the daily
// clear-then-scan automation. Local SQLite only; nothing leaves the machine.
import { clearAll } from '../queue.js';

async function main() {
  const archived = await clearAll();
  console.log(`Cleared ${archived} draft(s) from the queue.`);
}

main().catch(err => { console.error(err); process.exit(1); });
