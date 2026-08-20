import { communityBaseStatus, createApp } from './app.js';

const PORT = Number(process.env.PORT) || 8787;

createApp().listen(PORT, () => {
  // Aggregate tech log only — no request bodies, no meal text (privacy §2).
  console.log(`food-parse service listening on :${PORT}`);
  // An UNCONFIGURED shared food base is indistinguishable from a broken one
  // from the outside: the app's «общая база» search just answers «ничего не
  // нашлось» forever, and the sharing toggle appears to do nothing. One line at
  // startup turns "why is this feature dead" into a `journalctl` away.
  console.log(`shared food base: ${communityBaseStatus()}`);
});
