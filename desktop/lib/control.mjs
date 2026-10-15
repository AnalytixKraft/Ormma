/* The running Ormma's door for a second launcher: are you running, which
 * version, and stop. One JSON line in, one JSON line back.
 *
 * It is also how Ormma makes sure it runs once: a second service that finds
 * the door answered goes away, so there is only ever one app sending the
 * day's messages, and one bridge on the WhatsApp link. */

import { existsSync, unlinkSync } from "node:fs";
import { connect, createServer } from "node:net";

export class AlreadyRunning extends Error {}

/* Opens the door; `commands` maps each command to what answers it. Throws
 * AlreadyRunning when another Ormma has it open. */
export async function openControl(path, commands) {
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setTimeout(5000, () => socket.destroy());
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let reply;
      try {
        const { cmd } = JSON.parse(buffer.slice(0, newline));
        reply = Object.hasOwn(commands, cmd) ? await commands[cmd]() : { error: "unknown_command" };
      } catch (err) {
        reply = { error: String(err?.message || err) };
      }
      socket.end(`${JSON.stringify(reply)}\n`);
    });
    socket.on("error", () => {});
  });

  const listen = () =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });

  try {
    await listen();
  } catch (err) {
    if (err.code !== "EADDRINUSE") throw err;
    if (await ask(path, "status")) throw new AlreadyRunning(`Ormma is already running (${path})`);
    // A socket file left behind by an Ormma that did not get to close it.
    // (A Windows pipe goes with its process, so this is Mac and Linux only.)
    if (process.platform !== "win32" && existsSync(path)) unlinkSync(path);
    await listen();
  }
  return server;
}

/* The running Ormma's answer, or null when none is running. */
export function ask(path, cmd, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const socket = connect(path);
    let buffer = "";
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => done(null));
    socket.on("connect", () => socket.write(`${JSON.stringify({ cmd })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        done(JSON.parse(buffer.slice(0, newline)));
      } catch {
        done(null);
      }
    });
    socket.on("error", () => done(null));
    socket.on("end", () => done(null));
  });
}
