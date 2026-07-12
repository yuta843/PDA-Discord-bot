import { spawn } from "node:child_process";

function parseSleepTime(value) {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("SYSTEM_SLEEP_TIME must use HH:MM format.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function getNextSleepAt(value, now = new Date()) {
  const { hour, minute } = parseSleepTime(value);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function scheduleSystemSleep(value, onTrigger, now = new Date()) {
  const next = getNextSleepAt(value, now);
  const timer = setTimeout(onTrigger, next.getTime() - now.getTime());
  return { next, timer };
}

function launchWindowsSleepHelper() {
  if (process.platform !== "win32") {
    throw new Error("Automatic system sleep is supported only on Windows.");
  }

  const script = [
    "Start-Sleep -Seconds 2",
    "Add-Type -AssemblyName System.Windows.Forms",
    "[System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $true, $false)",
  ].join("; ");
  const helper = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  helper.unref();
}

export {
  getNextSleepAt,
  launchWindowsSleepHelper,
  parseSleepTime,
  scheduleSystemSleep,
};
