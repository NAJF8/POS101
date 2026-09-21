param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$PayloadPath
)
$ErrorActionPreference = 'Stop'
$resolved = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $resolved -or $resolved.Name -ne $PrinterName) { throw 'refusing unknown/non-installed printer name' }
$code = @'
using System;
using System.Runtime.InteropServices;
public static class RawSpool {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
 [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] static extern int StartDocPrinter(IntPtr h, int l, [In] DOCINFO d);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
 public static void Send(string name, byte[] bytes) { IntPtr h; if(!OpenPrinter(name,out h,IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { var d=new DOCINFO{pDocName="101 POS ESC/POS prototype",pDataType="RAW"}; if(StartDocPrinter(h,1,d)==0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { if(!StartPagePrinter(h)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { int w; if(!WritePrinter(h,bytes,bytes.Length,out w) || w!=bytes.Length) throw new Exception("WritePrinter incomplete"); } finally { EndPagePrinter(h); } } finally { EndDocPrinter(h); } } finally { ClosePrinter(h); } }
}
'@
Add-Type -TypeDefinition $code
[RawSpool]::Send($PrinterName, [IO.File]::ReadAllBytes($PayloadPath))
Write-Output (ConvertTo-Json @{ printer=$PrinterName; bytes=(Get-Item -LiteralPath $PayloadPath).Length; transport='WinSpool RAW'; status='sent' } -Compress)
