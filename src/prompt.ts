/**
 * Minimal interactive prompts using only Node.js built-ins.
 * Replaces @inquirer/prompts with zero dependencies.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ESC = "\x1b[";

export async function input(opts: { message: string }): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`${opts.message} `);
  } finally {
    rl.close();
  }
}

export async function password(opts: { message: string }): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(`${opts.message} `);

    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(buf);
          return;
        } else if (ch === "\x7f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write("\b \b");
          }
        } else if (ch === "\x03") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(false);
          process.exit(1);
        } else if (ch >= " ") {
          buf += ch;
          stdout.write("*");
        }
      }
    };

    stdin.on("data", onData);
  });
}

export async function confirm(opts: {
  message: string;
  default?: boolean;
}): Promise<boolean> {
  const hint = opts.default !== false ? "(Y/n)" : "(y/N)";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${opts.message} ${hint} `)).trim().toLowerCase();
    if (!answer) return opts.default !== false;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function select<T extends string>(opts: {
  message: string;
  choices: Array<{ name: string; value: T }>;
  default?: T;
}): Promise<T> {
  const { choices, message } = opts;
  let cursor = Math.max(0, choices.findIndex((ch) => ch.value === opts.default));

  return new Promise((resolve) => {
    const render = () => {
      // Move cursor up to re-render (skip on first render)
      stdout.write(`${ESC}?25l`); // hide cursor
      stdout.write(`\r${ESC}J`); // clear from cursor to end
      stdout.write(`${message}\n`);
      choices.forEach((ch, i) => {
        const pointer = i === cursor ? `${ESC}1;31m❯${ESC}0m ` : "  ";
        const label = i === cursor ? `${ESC}1;36m${ch.name}${ESC}0m` : ch.name;
        stdout.write(`${pointer}${label}\n`);
      });
    };

    render();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (key: string) => {
      if (key === "\x1b[A" || key === "k") {
        // Up
        cursor = (cursor - 1 + choices.length) % choices.length;
        stdout.write(`${ESC}${choices.length + 1}A`); // move up to re-render
        render();
      } else if (key === "\x1b[B" || key === "j") {
        // Down
        cursor = (cursor + 1) % choices.length;
        stdout.write(`${ESC}${choices.length + 1}A`);
        render();
      } else if (key === "\r" || key === "\n") {
        // Enter
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write(`${ESC}?25h`); // show cursor
        resolve(choices[cursor].value);
      } else if (key === "\x03") {
        // Ctrl+C
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdout.write(`${ESC}?25h`);
        process.exit(1);
      }
    };

    stdin.on("data", onData);
  });
}
