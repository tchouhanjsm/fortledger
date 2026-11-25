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
using System.Threading.Tasks;
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
    internal static string AppUrl()
    {
      string path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger","lan-settings.json");
      if(!File.Exists(path))return "http://127.0.0.1:3000/";
      try
      {
        var cfg=new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
        string host=Convert.ToString(cfg["host"]);
        IPAddress ip;
        if(Convert.ToInt32(cfg["version"])!=1 || Convert.ToInt32(cfg["port"])!=3000 ||
           !IPAddress.TryParse(host,out ip) || ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork)
          return "http://127.0.0.1:3000/";
        byte[] b=ip.GetAddressBytes();
        bool local=(b[0]==10)||(b[0]==192&&b[1]==168)||
          (b[0]==172&&b[1]>=16&&b[1]<=31);
        return local?"https://"+host+":3000/":"http://127.0.0.1:3000/";
      }
      catch{return "http://127.0.0.1:3000/";}
    }
    internal static void OpenApp()
    {
      try { Process.Start(AppUrl()); }
      catch { MessageBox.Show("Open "+AppUrl()+" in your browser.", "FortLedger"); }
    }
  }

  internal sealed class DesktopContext : ApplicationContext
  {
    private readonly string root;
    private readonly string data;
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer startTimer;
    private readonly System.Windows.Forms.Timer stopTimer;
    private readonly System.Windows.Forms.Timer patchTimer;
    private volatile string pendingPatchSha;
    private Task<int> patchTask;
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
      menu.Items.Add("Hotel LAN HTTPS - phone access (owner/IT)", null, delegate { ConfigureStaffLan(); });
      menu.Items.Add("Return to this computer only (owner/IT)", null, delegate { DisableStaffLan(); });
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("Close FortLedger safely", null, delegate { StopApp(); });
      tray.ContextMenuStrip = menu;
      tray.DoubleClick += delegate { Program.OpenApp(); };
      tray.Visible = true;
      startTimer = new System.Windows.Forms.Timer();
      startTimer.Interval = 600;
      startTimer.Tick += CheckStarted;
      stopTimer = new System.Windows.Forms.Timer();
      stopTimer.Interval = 700;
      stopTimer.Tick += CheckStopped;
      patchTimer = new System.Windows.Forms.Timer();
      patchTimer.Interval = 700;
      patchTimer.Tick += CheckCodeUpdate;
      patchTimer.Start();
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
      // A cheap automatic check, before any Node source or ledger is opened.
      // An interrupted patch must not boot mixed application files.
      string pending=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger","code-updates","source-update-pending.json");
      try
      {
        File.GetAttributes(pending);
        throw new InvalidOperationException("A source update was interrupted. Keep FortLedger closed and preserve the code-update recovery bundle and hotel data; owner/IT must verify program files before reopening.");
      }
      catch(FileNotFoundException) {}
      catch(DirectoryNotFoundException) {}
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
      psi.RedirectStandardOutput = true;
      psi.EnvironmentVariables["FORTLEDGER_DESKTOP_UPDATE_HOST"] = "1";
      ReadBackups(psi);
      ReadLan(psi);
      server = Process.Start(psi);
      if (server == null) throw new InvalidOperationException("The local Node runtime could not start.");
      pendingPatchSha=null;
      server.OutputDataReceived += ReceiveServerOutput;
      server.BeginOutputReadLine();
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
      psi.EnvironmentVariables.Remove("FORTLEDGER_DB");
      psi.EnvironmentVariables.Remove("FORTLEDGER_AUTH_FILE");
      psi.EnvironmentVariables.Remove("FORTLEDGER_BACKUP_DIR");
      psi.EnvironmentVariables.Remove("FORTLEDGER_BACKUP_PASSPHRASE");
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

    private void ReadLan(ProcessStartInfo psi)
    {
      string config=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger","lan-settings.json");
      if(!File.Exists(config))return; // Default remains strictly localhost-only.
      try
      {
        var cfg=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(config));
        string host=Convert.ToString(cfg["host"]);
        IPAddress ip;
        if(Convert.ToInt32(cfg["version"])!=1||Convert.ToInt32(cfg["port"])!=3000||
           !IPAddress.TryParse(host,out ip)||
           ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork)
          throw new InvalidOperationException();
        byte[] b=ip.GetAddressBytes();
        if(!(b[0]==10||(b[0]==192&&b[1]==168)||(b[0]==172&&b[1]>=16&&b[1]<=31)))
          throw new InvalidOperationException();
        string cert=Path.GetFullPath(Convert.ToString(cfg["certPath"]));
        string key=Path.GetFullPath(Convert.ToString(cfg["keyPath"]));
        if(!File.Exists(cert)||!File.Exists(key))throw new InvalidOperationException();
        psi.EnvironmentVariables["FORTLEDGER_LAN_ENABLED"]="1";
        psi.EnvironmentVariables["FORTLEDGER_HOST"]=host;
        psi.EnvironmentVariables["FORTLEDGER_TLS_CERT"]=cert;
        psi.EnvironmentVariables["FORTLEDGER_TLS_KEY"]=key;
        // The Node server checks certificate SAN/IP/date/private key pairing
        // BEFORE opening or migrating the SQLite ledger.
      }
      catch{throw new InvalidOperationException(
        "Private staff-Wi-Fi TLS configuration is invalid. Ask the owner/IT to correct it before starting.");}
    }

    private void ConfigureEmergencyLocalBackup(ProcessStartInfo psi)
    {
      // No owner action needed for same-machine emergency snapshots. This is
      // explicitly NOT a replacement for an external encrypted drive.
      string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger");
      string folder=Path.Combine(profile,"local-backups");
      string settingsFile=Path.Combine(profile,"local-backup-settings.json");
      Directory.CreateDirectory(folder);
      if((new DirectoryInfo(folder).Attributes & FileAttributes.ReparsePoint)!=0)
        throw new InvalidOperationException("Local backup folder is a redirected link; ask the owner to inspect it.");
      string passphrase;
      if(File.Exists(settingsFile))
      {
        try
        {
          var saved=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(
            File.ReadAllText(settingsFile));
          if(Convert.ToInt32(saved["version"])!=1)throw new InvalidOperationException();
          byte[] sealedBytes=Convert.FromBase64String(Convert.ToString(saved["passphrase_dpapi"]));
          byte[] plain=ProtectedData.Unprotect(sealedBytes,null,DataProtectionScope.CurrentUser);
          try{passphrase=Encoding.UTF8.GetString(plain);}
          finally{Array.Clear(plain,0,plain.Length);}
          if(passphrase.Length<16)throw new InvalidOperationException();
        }
        catch{throw new InvalidOperationException(
          "Local emergency backup key cannot be unlocked. Do not reset it or delete old backups; contact the owner.");}
      }
      else
      {
        // Without the original DPAPI secret old encrypted backups are not
        // recoverable. Never silently replace an existing backup key.
        if(Directory.GetFiles(folder,"fortledger-*.flbk").Length>0)
          throw new InvalidOperationException(
            "Local encrypted backups exist without their key. Do not generate a replacement backup password.");
        byte[] key=new byte[32];
        using(RandomNumberGenerator rng=RandomNumberGenerator.Create())rng.GetBytes(key);
        try{passphrase=Convert.ToBase64String(key);}
        finally{Array.Clear(key,0,key.Length);}
        byte[] bytes=Encoding.UTF8.GetBytes(passphrase);
        byte[] sealedKey;
        try{sealedKey=ProtectedData.Protect(bytes,null,DataProtectionScope.CurrentUser);}
        finally{Array.Clear(bytes,0,bytes.Length);}
        string json=new JavaScriptSerializer().Serialize(new Dictionary<string,object>{
          {"version",1},{"passphrase_dpapi",Convert.ToBase64String(sealedKey)}
        });
        using(FileStream stream=new FileStream(settingsFile,FileMode.CreateNew,
            FileAccess.Write,FileShare.None))
        using(StreamWriter writer=new StreamWriter(stream,new UTF8Encoding(false)))
          writer.Write(json);
        MessageBox.Show("Encrypted same-PC emergency backups have been enabled automatically. " +
          "They do not protect against Windows disk failure. The owner must configure a separate " +
          "protected backup drive before relying on updates.",
          "FortLedger backup protection",MessageBoxButtons.OK,MessageBoxIcon.Warning);
      }
      psi.EnvironmentVariables["FORTLEDGER_BACKUP_DIR"]=folder;
      psi.EnvironmentVariables["FORTLEDGER_BACKUP_PASSPHRASE"]=passphrase;
      psi.EnvironmentVariables["FORTLEDGER_BACKUP_LOCAL_ONLY"]="1";
      passphrase=null;
    }

    private void ReadBackups(ProcessStartInfo psi)
    {
      string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortLedger", "backup-settings.json");
      if (!File.Exists(config))
      {
        ConfigureEmergencyLocalBackup(psi);
        return;
      }
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
          if(!attempt.AsyncWaitHandle.WaitOne(150))return false;
          client.EndConnect(attempt);
          return true;
        }
      }
      catch { return false; }
    }
    private static bool Healthy()
    {
      try
      {
        HttpWebRequest req=(HttpWebRequest)WebRequest.Create(Program.AppUrl()+"api/auth/status");
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

    private void DisableStaffLan()
    {
      if(MessageBox.Show("Disable phone access and return to localhost-only on the next restart? " +
        "This will not change bookings, staff accounts or invoices.",
        "Disable staff-Wi-Fi access",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
      try
      {
        string file=Path.Combine(root,"scripts","windows-configure-staff-lan.ps1");
        var psi=new ProcessStartInfo("powershell.exe",
          "-NoProfile -ExecutionPolicy Bypass -File \"" + file + "\" -Disable");
        psi.WorkingDirectory=root;psi.UseShellExecute=true;psi.Verb="runas";
        Process.Start(psi);
        MessageBox.Show("After the owner/IT tool completes, safely close and reopen FortLedger to disable phone access.",
          "Staff Wi-Fi access",MessageBoxButtons.OK,MessageBoxIcon.Information);
      }
      catch(Exception ex){MessageBox.Show(ex.Message,"Unable to disable staff Wi-Fi");}
    }

    private void ConfigureStaffLan()
    {
      try
      {
        string file=Path.Combine(root,"scripts","windows-configure-staff-lan.ps1");
        if(!File.Exists(file))throw new FileNotFoundException("Hotel LAN HTTPS setup is unavailable");
        var psi=new ProcessStartInfo("powershell.exe",
          "-NoProfile -ExecutionPolicy Bypass -File \"" + file + "\"");
        psi.WorkingDirectory=root;
        psi.UseShellExecute=true;
        psi.Verb="runas"; // Windows UAC; never silently open the firewall.
        Process.Start(psi);
        MessageBox.Show("After owner/IT configuration, safely close and reopen FortLedger. " +
          "Authorized phones on the same router Wi-Fi must trust the HTTPS certificate and sign in with an individual FortLedger account. No second staff Wi-Fi is required. Never forward port 3000 to the internet.",
          "Hotel LAN phone access",MessageBoxButtons.OK,MessageBoxIcon.Information);
      }
      catch(Exception ex){MessageBox.Show(ex.Message,"Staff Wi-Fi setup blocked");}
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

    // A user-initiated update comes only from the authenticated owner route in
    // the packaged local Node child. This message is NOT an instruction to write
    // files yet: the launcher waits for clean HTTP/SQLite shutdown and exit 0.
    private void ReceiveServerOutput(object sender, DataReceivedEventArgs e)
    {
      const string marker = "FORTLEDGER_DESKTOP_PATCH:";
      string line = e.Data;
      if (String.IsNullOrEmpty(line) || !line.StartsWith(marker, StringComparison.Ordinal)) return;
      string sha = line.Substring(marker.Length).Trim().ToLowerInvariant();
      if (sha.Length != 40) return;
      foreach(char c in sha)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return;
      pendingPatchSha=sha;
    }

    private int ApplyPinnedCodePatch(string sha)
    {
      try
      {
        var psi=BaseNode("src\\desktop-code-update.js");
        psi.Arguments += " " + sha; // SHA is strictly 40 lowercase hex.
        psi.EnvironmentVariables["FORTLEDGER_DESKTOP_INSTALLER"]="1";
        psi.EnvironmentVariables["FORTLEDGER_DESKTOP_UPDATE_HOST"]="1";
        psi.RedirectStandardError=true;
        psi.RedirectStandardOutput=true;
        ReadBackups(psi);
        using(Process helper=Process.Start(psi))
        {
          if(helper==null)return 3;
          // No browser, SQLite connection or tray server is alive during patch.
          string error=helper.StandardError.ReadToEnd();
          helper.StandardOutput.ReadToEnd();
          helper.WaitForExit();
          if(helper.ExitCode!=0)
          {
            // The helper only returns code 1 when program files were unchanged
            // or safely rolled back. Code 3 means source consistency uncertain.
            File.AppendAllText(Path.Combine(Environment.GetFolderPath(
              Environment.SpecialFolder.LocalApplicationData),"FortLedger",
              "code-update-error.log"),DateTime.UtcNow.ToString("o")+" "+
              (helper.ExitCode==3?"Code rollback unconfirmed":"Code update refused")+
              Environment.NewLine);
          }
          return helper.ExitCode;
        }
      }
      catch { return 3; } // fail closed; do not guess state of installed code
    }

    private void CheckCodeUpdate(object sender, EventArgs e)
    {
      if(patchTask!=null)
      {
        if(!patchTask.IsCompleted)return;
        int result;
        try{result=patchTask.Result;}catch{result=3;}
        patchTask=null;pendingPatchSha=null;
        if(result==3)
        {
          MessageBox.Show("The code update stopped without a verified rollback. Do not reopen " +
            "FortLedger or reset the hotel database. Ask the owner/IT to inspect the " +
            "local update journal and recover only program files from the reviewed build.",
            "FortLedger update paused",MessageBoxButtons.OK,MessageBoxIcon.Error);
          ExitThread();return;
        }
        try{ Launch(); }
        catch(Exception ex)
        {
          MessageBox.Show("FortLedger did not restart safely: "+ex.Message+
            ". Hotel records have not been erased. Do not reinstall or reset the data.",
            "FortLedger restart blocked",MessageBoxButtons.OK,MessageBoxIcon.Error);
          ExitThread();return;
        }
        if(result!=0)
          MessageBox.Show("Code update refused safely. Your existing app was restarted " +
            "without overwriting the hotel data. Review the backup and Update Center before retrying.",
            "FortLedger update not installed",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        return;
      }
      string sha=pendingPatchSha;
      if(String.IsNullOrEmpty(sha)||server==null||!server.HasExited)return;
      startTimer.Stop();stopTimer.Stop();
      server.WaitForExit(); // drain asynchronous stdout callback
      if(server.ExitCode!=0)
      {
        pendingPatchSha=null;
        MessageBox.Show("Cannot confirm safe database shutdown. No code patch was started. " +
          "Inspect the original hotel process and backups before reopening.",
          "FortLedger update blocked",MessageBoxButtons.OK,MessageBoxIcon.Error);
        ExitThread();return;
      }
      patchTask=Task.Run(()=>ApplyPinnedCodePatch(sha));
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
      startTimer.Stop();stopTimer.Stop();patchTimer.Stop();tray.Visible=false;tray.Dispose();
      base.ExitThreadCore();
    }
    public new void Dispose()
    {
      if(tray!=null)tray.Dispose();
      if(startTimer!=null)startTimer.Dispose();
      if(stopTimer!=null)stopTimer.Dispose();
      if(patchTimer!=null)patchTimer.Dispose();
    }
  }
}
