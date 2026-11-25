# 枚举所有可见顶层窗口（标题+所属进程），循环 N 秒，输出匹配关键词的窗口
param([int]$Seconds = 12, [string]$Keywords = "postgres|pg_ctl|conhost|MusicBox|tar\.exe")

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static List<string> Snap() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) {
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (sb.Length > 0) list.Add(pid + "|" + sb.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$seen = @{}
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  foreach ($item in [WinEnum]::Snap()) {
    $idx = $item.IndexOf('|')
    $pid2 = $item.Substring(0, $idx)
    $title = $item.Substring($idx + 1)
    if ($title -match $Keywords -and -not $seen.ContainsKey($item)) {
      $pname = try { (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { '?' }
      Write-Output ("WINDOW pid=" + $pid2 + " proc=" + $pname + " title=" + $title)
      $seen[$item] = $true
    }
  }
  Start-Sleep -Milliseconds 300
}
Write-Output "POLL_DONE"
