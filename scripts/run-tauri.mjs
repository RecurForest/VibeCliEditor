import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const cliEntry = resolve(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const command = process.argv[2];

if (!existsSync(cliEntry)) {
  console.error("Missing @tauri-apps/cli. Run `pnpm install` first.");
  process.exit(1);
}

const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const defaultCargoTargetDir = join(projectRoot, ".cargo-target");
const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? resolve(process.env.CARGO_TARGET_DIR)
  : defaultCargoTargetDir;
const pathEntries = (process.env.PATH ?? "").split(";");
const env = { ...process.env };

if (cargoBin && existsSync(cargoBin) && !pathEntries.includes(cargoBin)) {
  env.PATH = `${cargoBin};${process.env.PATH ?? ""}`;
}

env.CARGO_TARGET_DIR = cargoTargetDir;
env.CARGO_BUILD_JOBS = "1";
env.CARGO_INCREMENTAL = "0";
env.CARGO_BUILD_PIPELINING = "false";
env.VIBE_CLI_EDITOR_PROJECT_ROOT = projectRoot;

if (process.platform === "win32" && command === "dev") {
  cleanupWindowsDevProcesses();
}

const child = spawn(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

function cleanupWindowsDevProcesses() {
  const targetExe = join(cargoTargetDir, "debug", "VibeCliEditor.exe");
  const viteEntry = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const projectRootPath = projectRoot;

  const escapePowerShell = (value) => value.replaceAll("'", "''");
  const script = `
$targetExe = '${escapePowerShell(targetExe)}'
$viteEntry = '${escapePowerShell(viteEntry)}'
$cargoTargetDir = '${escapePowerShell(cargoTargetDir)}'
$projectRoot = '${escapePowerShell(projectRootPath)}'

$portProcesses = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 1420, 1421 } |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
    $process -and (
      $process.ExecutablePath -eq $targetExe -or
      ($process.Name -eq 'node.exe' -and (
        $process.CommandLine -like "*$viteEntry*" -or
        ($process.CommandLine -like "*$projectRoot*" -and $process.CommandLine -like "*vite*")
      ))
    )
  })

$projectProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -eq $targetExe -or
  ($_.Name -eq 'node.exe' -and (
    $_.CommandLine -like "*$viteEntry*" -or
    ($_.CommandLine -like "*$projectRoot*" -and $_.CommandLine -like "*vite*")
  )) -or
  ($_.Name -in 'cargo.exe', 'rustc.exe', 'build-script-build.exe' -and (
    $_.CommandLine -like "*$projectRoot*" -or
    $_.CommandLine -like "*$cargoTargetDir*"
  )) -or
  ($_.ExecutablePath -like "$cargoTargetDir\\*" -and $_.Name -like '*.exe')
} | Select-Object -ExpandProperty ProcessId -Unique)

($portProcesses + $projectProcesses | Sort-Object -Unique) | ForEach-Object {
  if ($_ -and $_ -ne $PID) {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
}
`;

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
    });
  } catch {
    // Continue even if cleanup fails; the tauri command will surface the real startup error.
  }
}
