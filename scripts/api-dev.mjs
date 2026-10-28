import ts from 'typescript';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
let server;
let closing = false;
let restarting = Promise.resolve();
const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => apiRoot,
  getNewLine: () => '\n',
};
const report = (diagnostic) => process.stdout.write(ts.formatDiagnostic(diagnostic, formatHost));
const host = ts.createWatchCompilerHost(
  fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)),
  {},
  ts.sys,
  ts.createEmitAndSemanticDiagnosticsBuilderProgram,
  report,
  report,
);
const emit = host.afterProgramCreate;
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const current = server;
  await new Promise((resolve) => {
    current.once('exit', resolve);
    current.kill('SIGTERM');
  });
}
host.afterProgramCreate = (builder) => {
  emit?.(builder);
  if (
    ts
      .getPreEmitDiagnostics(builder.getProgram())
      .some((item) => item.category === ts.DiagnosticCategory.Error)
  )
    return;
  restarting = restarting.then(async () => {
    await stopServer();
    if (closing) return;
    server = spawn(process.execPath, ['--watch', 'dist/main.js'], {
      cwd: apiRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    server.once('error', () => {
      console.error('Не удалось запустить API.');
      process.exitCode = 1;
    });
  });
};
const watcher = ts.createWatchProgram(host);
async function shutdown() {
  if (closing) return;
  closing = true;
  watcher.close();
  await restarting;
  await stopServer();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
