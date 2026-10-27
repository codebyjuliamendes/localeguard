/** Development runner: esbuild watch for the client + tsx watch for the server, sharing one terminal. */
import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [
  spawn('tsx', ['scripts/build-web.ts', '--watch'], { stdio: 'inherit' }),
  spawn('tsx', ['watch', '--clear-screen=false', 'src/server.ts'], { stdio: 'inherit' }),
];

const stop = (code = 0): void => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
};
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
