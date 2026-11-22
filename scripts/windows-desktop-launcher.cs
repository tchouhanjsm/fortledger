// .NET Framework 4 desktop tray shell around the existing local Node/SQLite app.
// Staff click ONE icon. No Electron, cloud account, Git, npm or terminal needed.
// The launcher owns the Node stdin shutdown pipe and never force-kills payments.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.Serialization;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("FortLedger")]
[assembly: AssemblyDescription("Local hotel and restaurant desktop launcher")]
[assembly: AssemblyCompany("Garh Jaisal")]
[assembly: AssemblyProduct("FortLedger Desktop")]
[assembly: AssemblyVersion("0.1.0.0")]

namespace FortLedgerDesktop
{
  internal static class Program
  {
    [STAThread]
    private static void Main()
    {
      bool ownsMutex = false;
      using (Mutex mutex = new Mutex(true, @"Local\FortLedgerDesktopTray", out ownsMutex))
      {
        if (!ownsMutex)
        {
          OpenApp();
          return;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (DesktopContext app = new DesktopContext())
          Application.Run(app);
        GC.KeepAlive(mutex);
      }
    }
    internal static void OpenApp()
    {
      try { Process.Start("http://127.0.0.1:3000/"); }
      catch { MessageBox.Show("Open http://127.0.0.1:3000 in your browser.", "FortLedger"); }
    }
  }

  internal sealed class DesktopContext : ApplicationContext
  {
    private readonly string root;
    private readonly string data;
    private readonly NotifyIcon tray;
    private readonly Timer startTimer;
    private readonly Timer stopTimer;
    private Process server;
    private int attempts;
    private bool stopping;

    public DesktopContext()
    {
      root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
      data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FortLedger", "data");
      tray = new NotifyIcon();
      tray.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
      tray.Text = "FortLedger — local hotel app";
      ContextMenuStrip menu = new ContextMenuStrip();
      menu.Items.Add("Open FortLedger", null, delegate { Program.OpenApp(); });
      menu.Items.Add("Configure encrypted backups (owner)", null, delegate { ConfigureBackups(); });
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("Close FortLedger safely", null, delegate { StopApp(); });
      tray.ContextMenuStrip = menu;
      tray.DoubleClick += delegate { Program.OpenApp(); };
      tray.Visible = true;
      startTimer = new Timer();
      startTimer.Interval = 600;
      startTimer.Tick += CheckStarted;
      stopTimer = new Timer();
      stopTimer.Interval = 700;
      stopTimer.Tick += CheckStopped;
      try { Launch(); }
      catch (Exception ex)
      {
        MessageBox.Show("FortLedger could not start. Hotel records were not erased.\n\n" +
          ex.Message + "\n\nAsk the owner to check this computer and the protected backups.",
          "FortLedger startup blocked", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitThread();
      }
    }

    private void Launch()
    {
      string db = Path.Combine(data, "fortledger.sqlite");
      string auth = Path.Combine(data, "admin-auth.json");
      bool hasDb = File.Exists(db), hasAuth = File.Exists(auth);
      if (hasDb != hasAuth)
        throw new InvalidOperationException("An existing database or owner-password file is missing. Do not initialize a replacement hotel ledger.");
      if (IsPortInUse())
        throw new InvalidOperationException("Port 3000 is already used by another process. Finish the other FortLedger session before starting this one.");
      if (!hasDb && !hasAuth) FirstRun();
      var psi = BaseNode("src\\server.js");
      psi.EnvironmentVariables["FORTLEDGER_DESKTOP_INSTALLER"] = "1";
      psi.RedirectStandardInput = true;
      ReadBackups(psi);
      server = Process.Start(psi);
      if (server == null) throw new InvalidOperationException("The local Node runtime could not start.");
      attempts = 0;
      startTimer.Start();
    }

    private ProcessStartInfo BaseNode(string script)
    {
      var node = Path.Combine(root, "node.exe");
      if (!File.Exists(node)) throw new InvalidOperationException("Bundled Node runtime missing. Reinstall only from a trusted verified installer.");
      var psi = new ProcessStartInfo(node, script);
      psi.WorkingDirectory = root;
      psi.UseShellExecute = false;
      psi.CreateNoWindow = true;
      psi.WindowStyle = ProcessWindowStyle.Hidden;
      psi.EnvironmentVariables["FORTLEDGER_DATA_DIR"] = data;
      psi.EnvironmentVariables["FORTLEDGER_HOST"] = "127.0.0.1";
      psi.EnvironmentVariables["PORT"] = "3000";
      psi.EnvironmentVariables["FORTLEDGER_LAN_ENABLED"] = "0";
      psi.EnvironmentVariables.Remove("FORTLEDGER_TLS_CERT");
      psi.EnvironmentVariables.Remove("FORTLEDGER_TLS_KEY");
      return psi;
    }

    private void FirstRun()
    {
      string password;
      using (Form window = new Form())
      {
        window.Text = "Set up FortLedger owner";
        window.Width = 450; window.Height = 265; window.StartPosition = FormStartPosition.CenterScreen;
        window.FormBorderStyle = FormBorderStyle.FixedDialog;
        window.MaximizeBox = false; window.MinimizeBox = false;
        Label explanation = new Label();
        explanation.Left = 18; explanation.Top = 14; explanation.Width = 398; explanation.Height = 48;
        explanation.Text = "New hotel installation: set a private owner password (12+ characters). Keep it somewhere safe. Staff will sign in separately.";
        window.Controls.Add(explanation);
        Label one = new Label { Left=18, Top=70, Width=160, Text="Owner password" };
        Label two = new Label { Left=18, Top=119, Width=160, Text="Confirm password" };
        TextBox pass = new TextBox { Left=182, Top=67, Width=230, UseSystemPasswordChar=true, MaxLength=256 };
        TextBox confirm = new TextBox { Left=182, Top=116, Width=230, UseSystemPasswordChar=true, MaxLength=256 };
        Button ok = new Button { Text="Create owner", Left=260, Top=166, Width=150, DialogResult=DialogResult.None };
        Button cancel = new Button { Text="Cancel", Left=164, Top=166, Width=85, DialogResult=DialogResult.Cancel };
        window.Controls.AddRange(new Control[]{one,two,pass,confirm,ok,cancel});
        window.AcceptButton = ok; window.CancelButton = cancel;
        ok.Click += delegate {
          if (pass.Text.Length < 12 || pass.Text.Length > 256 ||
              pass.Text.IndexOf('\n') >= 0 || pass.Text.IndexOf('\r') >= 0 ||
              pass.Text != confirm.Text)
          {
            MessageBox.Show("Use a 12–256 character owner password and confirm it exactly.", "Check owner password");
            return;
          }
          window.DialogResult=DialogResult.OK;
        };
        if (window.ShowDialog()!=DialogResult.OK)
          throw new InvalidOperationException("Owner setup cancelled. No empty hotel ledger was created.");
        password=pass.Text;
        pass.Clear(); confirm.Clear();
      }
      ProcessStartInfo psi = BaseNode("src\\desktop-first-run.js");
      psi.RedirectStandardInput = true;
      psi.RedirectStandardError = true;
      psi.RedirectStandardOutput = true;
      using (Process process = Process.Start(psi))
      {
        if (process==null) throw new InvalidOperationException("Owner initialization failed to start.");
        process.StandardInput.WriteLine(password);
        process.StandardInput.Close();
        password = null;
        string error = process.StandardError.ReadToEnd();
        process.StandardOutput.ReadToEnd();
        if (!process.WaitForExit(60000) || process.ExitCode != 0)
          throw new InvalidOperationException("Owner initialization did not finish. " + error.Trim());
      }
    }

    private void ReadBackups(ProcessStartInfo psi)
    {
      string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger", "backup-settings.json");
      if (!File.Exists(config)) return; // Alpha fresh install: owner sets backup drive separately.
      try
      {
        var settings = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(config));
        if (!settings.ContainsKey("version") || Convert.ToInt32(settings["version"])!=1)
          throw new InvalidOperationException();
        string directory=Convert.ToString(settings["directory"]);
        string secret=Convert.ToString(settings["passphrase_dpapi"]);
        if (!Path.IsPathRooted(directory) || !Directory.Exists(directory) ||
            String.Equals(Path.GetPathRoot(Path.GetFullPath(directory)),
              Path.GetPathRoot(Path.GetFullPath(data)),StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException();
        byte[] encrypted = Convert.FromBase64String(secret);
        byte[] clear = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
        try
        {
          string passphrase=Encoding.UTF8.GetString(clear);
          if (passphrase.Length<16) throw new InvalidOperationException();
          psi.EnvironmentVariables["FORTLEDGER_BACKUP_DIR"] = Path.GetFullPath(directory);
          psi.EnvironmentVariables["FORTLEDGER_BACKUP_PASSPHRASE"] = passphrase;
          passphrase=null;
        }
        finally { Array.Clear(clear,0,clear.Length); }
      }
      catch
      {
        throw new InvalidOperationException("Encrypted-backup settings cannot be unlocked or the protected drive is missing. Ask the owner to reconnect the drive or reconfigure backups.");
      }
    }

    private static bool IsPortInUse()
    {
      try
      {
        using (var client = new System.Net.Sockets.TcpClient())
        {
          IAsyncResult attempt=client.BeginConnect("127.0.0.1",3000,null,null);
          return attempt.AsyncWaitHandle.WaitOne(150);
        }
      }
      catch { return false; }
    }
    private static bool Healthy()
    {
      try
      {
        HttpWebRequest req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3000/api/auth/status");
        req.Timeout=750;
        req.Proxy=null;
        using(HttpWebResponse response=(HttpWebResponse)req.GetResponse())
          return response.StatusCode==HttpStatusCode.OK;
      }
      catch { return false; }
    }

    private void CheckStarted(object sender, EventArgs e)
    {
      attempts++;
      if (server==null || server.HasExited)
      {
        startTimer.Stop();
        MessageBox.Show("FortLedger server did not start. Existing hotel records were not deleted. Ask the owner to run diagnostics.",
          "FortLedger",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        return;
      }
      if (Healthy())
      {
        startTimer.Stop();
        Program.OpenApp();
      }
      else if (attempts>=80)
      {
        startTimer.Stop();
        MessageBox.Show("FortLedger is still starting. Use Open FortLedger from the system tray after it becomes available.",
          "FortLedger",MessageBoxButtons.OK,MessageBoxIcon.Information);
      }
    }

    private void ConfigureBackups()
    {
      try
      {
        string file=Path.Combine(root,"scripts","windows-configure-backups.ps1");
        if(!File.Exists(file)) throw new FileNotFoundException("Backup configuration tool missing");
        var psi=new ProcessStartInfo("powershell.exe",
          "-NoProfile -ExecutionPolicy Bypass -File \"" + file + "\"");
        psi.WorkingDirectory=root;
        psi.UseShellExecute=true;
        Process.Start(psi);
        MessageBox.Show("Finish the backup setup in the opened window, then safely close and reopen FortLedger to load the settings.",
          "Backup configuration",MessageBoxButtons.OK,MessageBoxIcon.Information);
      }
      catch (Exception ex) { MessageBox.Show(ex.Message,"Backup configuration unavailable"); }
    }

    private void StopApp()
    {
      if (stopping) return;
      if (server==null || server.HasExited) { ExitThread(); return; }
      if (MessageBox.Show("Finish any current booking or bill first. Close FortLedger after existing requests finish?",
        "Close FortLedger safely",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes) return;
      try
      {
        startTimer.Stop();
        server.StandardInput.Write("FORTLEDGER_DESKTOP_QUIT\n");
        server.StandardInput.Flush();
        stopping=true;
        attempts=0;
        stopTimer.Start();
      }
      catch(Exception ex) { MessageBox.Show("Cannot confirm a safe shutdown: "+ex.Message+
        ". Do not force-close while processing money.", "FortLedger"); }
    }
    private void CheckStopped(object sender, EventArgs e)
    {
      attempts++;
      if(server==null || server.HasExited)
      {
        stopTimer.Stop();
        ExitThread();
      }
      else if(attempts==60)
        MessageBox.Show("Still finishing active requests. FortLedger will close when the hotel ledger is safe. Do not force-close the server.",
          "Finishing hotel work",MessageBoxButtons.OK,MessageBoxIcon.Information);
    }
    protected override void ExitThreadCore()
    {
      startTimer.Stop();stopTimer.Stop();tray.Visible=false;tray.Dispose();
      base.ExitThreadCore();
    }
    public new void Dispose()
    {
      if(tray!=null)tray.Dispose();
      if(startTimer!=null)startTimer.Dispose();
      if(stopTimer!=null)stopTimer.Dispose();
    }
  }
}
