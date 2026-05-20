import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");

// Windows 上 electron-builder 残留的子进程（rcedit / app-builder）以及
// 上一次产物的 Git Manager.exe 都可能锁 release/ 目录，先 taskkill 再删。
const WIN_TARGET_NAMES = [
  "Git Manager.exe",
  "rcedit-x64.exe",
  "rcedit-ia32.exe",
  "app-builder.exe",
];

function killByName(name) {
  try {
    execSync(`taskkill /F /IM "${name}" /T`, { stdio: "pipe" });
    console.log(`[prebuild-clean] killed ${name}`);
  } catch {}
}

function killProjectLocalProcesses() {
  const escaped = root.replace(/\\/g, "\\\\").replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${escaped}*' } | Select-Object -ExpandProperty ProcessId`;
  try {
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid} /T`, { stdio: "pipe" });
        console.log(`[prebuild-clean] killed PID ${pid} (running from project dir)`);
      } catch {}
    }
  } catch {}
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function tryRemoveRelease() {
  if (!(await exists(releaseDir))) return true;
  const maxAttempts = process.platform === "win32" ? 5 : 1;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await fs.rm(releaseDir, { recursive: true, force: true });
      console.log("[prebuild-clean] removed release/");
      return true;
    } catch (err) {
      const msg = String(err?.message ?? err).split(/\r?\n/)[0];
      console.log(`[prebuild-clean] remove attempt ${i}/${maxAttempts} failed: ${msg}`);
      if (i < maxAttempts) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

if (process.platform === "win32") {
  for (const n of WIN_TARGET_NAMES) killByName(n);
  killProjectLocalProcesses();
} else {
  console.log(`[prebuild-clean] ${process.platform}: skip process killing, only clean release/`);
}

const ok = await tryRemoveRelease();
if (!ok) {
  console.log(
    "[prebuild-clean] release/ still locked; electron-builder will try to overwrite in place."
  );
}
