export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const { startBackgroundWorker } = await import('./lib/server/background-worker');
  startBackgroundWorker();
}
