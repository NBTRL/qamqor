// Migrations run once in the mandatory web build, before this deployment is published.
// The HTTP container delegates all background jobs to the separately deployed daemon.
process.env.VERCEL = '1';
await import('../main.js');
