import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireSingleInstance, SingleInstanceError } from "../src/single-instance.js";

function withLockPath(callback) {
  const directory = mkdtempSync(join(tmpdir(), "miq-single-instance-"));
  const lockPath = join(directory, "bot.lock");
  try {
    return callback(lockPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("allows one instance and rejects a second live owner", () => {
  withLockPath((lockPath) => {
    const release = acquireSingleInstance(lockPath, {
      pid: 1001,
      processKill: (pid) => {
        if (pid === 1001) return true;
        const error = new Error("not found");
        error.code = "ESRCH";
        throw error;
      },
      registerExitHandler: false,
    });

    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf8")).pid, 1001);
    assert.throws(
      () => acquireSingleInstance(lockPath, {
        pid: 1002,
        processKill: (pid) => {
          if (pid === 1001) return true;
          const error = new Error("not found");
          error.code = "ESRCH";
          throw error;
        },
        registerExitHandler: false,
      }),
      (error) => error instanceof SingleInstanceError && error.ownerPid === 1001,
    );
    release();
  });
});

test("recovers a lock left by a stopped process", () => {
  withLockPath((lockPath) => {
    writeFileSync(lockPath, JSON.stringify({ pid: 2001 }), "utf8");

    const secondRelease = acquireSingleInstance(lockPath, {
      pid: 2002,
      processKill: () => {
        const error = new Error("not found");
        error.code = "ESRCH";
        throw error;
      },
      registerExitHandler: false,
    });
    secondRelease();
  });
});
