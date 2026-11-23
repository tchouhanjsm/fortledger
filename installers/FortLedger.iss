; FortLedger per-user installer. No Git/Node/PowerShell commands for staff.
; Build inputs are staged by scripts/build-windows-installer.ps1 on Windows CI.
#ifndef AppVersion
  #define AppVersion "0.1.0.1"
#endif

[Setup]
AppId={{F75885D2-D5D8-40F2-A9F6-A5B988A43E6C}
AppName=FortLedger
AppVersion={#AppVersion}
AppVerName=FortLedger {#AppVersion} (Alpha)
AppPublisher=Garh Jaisal
AppPublisherURL=https://github.com/tchouhanjsm/fortledger
DefaultDirName={localappdata}\Programs\FortLedger
DefaultGroupName=FortLedger
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=FortLedger-Setup-{#AppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
SetupIconFile=..\dist\windows\app\fortledger.ico
UninstallDisplayIcon={app}\FortLedger.exe
CloseApplications=no
RestartApplications=no
ChangesAssociations=no
DisableWelcomePage=no
AllowNoIcons=no
CreateUninstallRegKey=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\windows\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\windows-installer-guard.ps1"; Flags: dontcopy
Source: "..\scripts\windows-verify-owner-companion.mjs"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\FortLedger"; Filename: "{app}\FortLedger.exe"; WorkingDir: "{app}"; Comment: "Open the local hotel application"
Name: "{autodesktop}\FortLedger"; Filename: "{app}\FortLedger.exe"; WorkingDir: "{app}"; Comment: "Start FortLedger and open the hotel login"

[Run]
Filename: "{app}\FortLedger.exe"; Description: "Open FortLedger"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Parameters: String;
begin
  Result := '';
  ExtractTemporaryFile('windows-installer-guard.ps1');
  ExtractTemporaryFile('windows-verify-owner-companion.mjs');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\windows-installer-guard.ps1') + '" -InstallDirectory "' +
    ExpandConstant('{app}') + '" -Verifier "' +
    ExpandConstant('{tmp}\windows-verify-owner-companion.mjs') + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
              Parameters, '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
  begin
    Result := 'Installation stopped safely before replacing program files.' + #13#10 +
      'If the app is reported running after Task Manager was used, its separate Node server ' +
      'may still be listening on port 3000.' + #13#10 +
      'First finish all hotel bills and confirm your protected backup. Close FortLedger ' +
      'from its Windows tray icon: Close FortLedger safely.' + #13#10 +
      'If the tray was already terminated, restart Windows normally and run this installer ' +
      'BEFORE starting FortLedger again. Never kill an unknown port-3000 process.' + #13#10 +
      'A verified separate-drive encrypted database AND owner credential restore remains ' +
      'mandatory for an existing hotel installation. This installer does not reset hotel data.';
  end;
end;
