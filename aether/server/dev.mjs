import { spawn } from 'node:child_process';

const commands = [
  ['rooms', ['server/rooms.js']],
  ['vite', ['node_modules/vite/bin/vite.js', '--host']],
];
const children = commands.map(([name, script]) => {
  const child = spawn(process.execPath, script, { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${name} exited with code ${code}`);
  });
  return child;
});

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', () => {
    if (children.some((other) => other.exitCode === null)) shutdown();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
