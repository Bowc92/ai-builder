using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
class Launcher {
  [STAThread] static void Main() {
    string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Start-Builder-UI.ps1");
    if (!File.Exists(script)) { MessageBox.Show("AI Builder files are missing. Run the installer to repair."); return; }
    Process.Start(new ProcessStartInfo("powershell.exe", "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"") { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=Path.GetDirectoryName(script) });
  }
}
