import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

class SingleInstanceError extends Error {
  constructor(lockPath, ownerPid = null) {
    const owner = Number.isInteger(ownerPid) ? ` (PID ${ownerPid})` : "";
    super(`The bot is already running${owner}. Stop the existing instance before starting another.`);
    this.name = "SingleInstanceError";
    this.code = "BOT_ALREADY_RUNNING";
    this.lockPath = lockPath;
    this.ownerPid = ownerPid;
  }
}

function isProcessAlive(pid, processKill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    processKill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwnerPid(lockPath, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(lockPath, "utf8"));
    return Number.isInteger(parsed?.pid) && parsed.pid > 0 ? parsed.pid : null;
  } catch {
    return null;
  }
}

function acquireSingleInstance(
  lockPath,
  {
    pid = process.pid,
    processKill = process.kill,
    registerExitHandler = true,
  } = {},
) {
  if (!lockPath) throw new TypeError("A single-instance lock path is required.");
  const directory = dirname(lockPath);
  if (directory && directory !== ".") mkdirSync(directory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fileDescriptor;
    try {
      fileDescriptor = openSync(lockPath, "wx");
      writeFileSync(fileDescriptor, `${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    } catch (error) {
      if (fileDescriptor !== undefined) {
        try {
          closeSync(fileDescriptor);
        } finally {
          try {
            unlinkSync(lockPath);
          } catch (unlinkError) {
            if (unlinkError?.code !== "ENOENT") throw unlinkError;
          }
        }
      }
      if (error?.code !== "EEXIST") throw error;

      const ownerPid = readOwnerPid(lockPath);
      if (isProcessAlive(ownerPid, processKill)) {
        throw new SingleInstanceError(lockPath, ownerPid);
      }

      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code === "ENOENT") continue;
        throw unlinkError;
      }
      continue;
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        closeSync(fileDescriptor);
      } finally {
        try {
          unlinkSync(lockPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    };

    if (registerExitHandler) process.once("exit", release);
    return release;
  }

  throw new SingleInstanceError(lockPath);
}

export { SingleInstanceError, acquireSingleInstance, isProcessAlive };
