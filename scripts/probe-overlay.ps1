# Sonda del overlay de Computer Use: ventana de clase CodexComputerUseCursorOverlay,
# proceso helper y su hijo --system-cursor-manager.
# Uso: powershell -NoProfile -File dev\probe-overlay.ps1 -Label texto
param([string]$Label = "probe")

$src = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public static string Scan() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var t = cls.ToString();
      if (t.IndexOf("ComputerUse", StringComparison.OrdinalIgnoreCase) >= 0 || t.IndexOf("CursorOverlay", StringComparison.OrdinalIgnoreCase) >= 0) {
        var title = new StringBuilder(512); GetWindowTextW(h, title, 512);
        sb.AppendLine("    window class='" + t + "' visible=" + IsWindowVisible(h) + " title='" + title.ToString() + "'");
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@

try { Add-Type -TypeDefinition $src -ErrorAction Stop } catch { }

$wins = [W]::Scan()
$procs = Get-CimInstance Win32_Process -Filter "Name = 'codex-computer-use.exe' OR Name = 'codex-computer-use-swift.exe'" -ErrorAction SilentlyContinue
Write-Output "[$Label] ventanas de overlay:"
if ([string]::IsNullOrWhiteSpace($wins)) { Write-Output "    (ninguna)" } else { Write-Output $wins.TrimEnd() }
Write-Output "[$Label] procesos helper: $($procs.Count)"
foreach ($p in $procs) {
  $cmd = $p.CommandLine
  if ($cmd -and $cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 160) }
  $mark = if ($p.CommandLine -match 'system-cursor-manager') { "  <-- cursor-manager" } else { "" }
  Write-Output "    pid=$($p.ProcessId) ppid=$($p.ParentProcessId)$mark"
}
