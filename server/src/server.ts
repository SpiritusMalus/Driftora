import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 8787;

createApp().listen(PORT, () => {
  // Aggregate tech log only — no request bodies, no meal text (privacy §2).
  console.log(`food-parse service listening on :${PORT}`);
});
