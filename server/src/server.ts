import { communityBaseStatus, createApp } from './app.js';

const PORT = Number(process.env.PORT) || 8787;
// Loopback only. The service is always fronted by Caddy (which terminates TLS and
// is the thing that sets the X-Forwarded-For this app's `trust proxy 1` relies on),
// so nothing should ever reach node except through that hop.
//
// Binding 0.0.0.0 — the default — put the backend on every interface the box has.
// The internet itself was still closed off by ufw, but anything already routed onto
// the host (this VPS also terminates a VPN whose exit is this same address) could
// talk to node DIRECTLY, skipping Caddy. On that path X-Forwarded-For is whatever
// the caller typed, and `trust proxy 1` believes it: measured 2026-08-28, each
// spoofed value opened its OWN rate-limit bucket (remaining=119, 119, 118 for
// 9.9.9.9 / 8.8.8.8 / 9.9.9.9), i.e. the per-IP caps could be lapped at will.
// Through Caddy the same probe correctly shared one bucket (119→118→117).
// `HOST` stays overridable for container setups that must publish a port.
const HOST = process.env.HOST || '127.0.0.1';

createApp().listen(PORT, HOST, () => {
  // Aggregate tech log only — no request bodies, no meal text (privacy §2).
  console.log(`food-parse service listening on ${HOST}:${PORT}`);
  // An UNCONFIGURED shared food base is indistinguishable from a broken one
  // from the outside: the app's «общая база» search just answers «ничего не
  // нашлось» forever, and the sharing toggle appears to do nothing. One line at
  // startup turns "why is this feature dead" into a `journalctl` away.
  console.log(`shared food base: ${communityBaseStatus()}`);
});
