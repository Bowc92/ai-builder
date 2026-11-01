[Setup]
AppId={{C840415D-4E74-4A60-B726-117D136D05CB}
AppName=AI Builder Preview
AppVersion=0.1.0
AppPublisher=Bowc92
AppPublisherURL=https://github.com/Bowc92/ai-builder
DefaultDirName={%USERPROFILE}\AI-Builder
DefaultGroupName=AI Builder
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=AI-Builder-Setup-0.1.0-preview
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\AI Builder.exe
CloseApplications=no
LicenseFile=..\LICENSE
InfoBeforeFile=..\INSTALL_NOTES.txt
DisableProgramGroupPage=yes
[Files]
Source: "..\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: checkedonce
[Icons]
Name: "{autodesktop}\AI Builder"; Filename: "{app}\AI Builder.exe"; Tasks: desktopicon
Name: "{group}\AI Builder"; Filename: "{app}\AI Builder.exe"
[Run]
Filename: "{app}\AI Builder.exe"; Description: "Launch AI Builder"; Flags: nowait postinstall skipifsilent
[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if CheckForMutexes('Local\AIBuilderInstallerTest') then Result := 'Close the installer test before continuing.';
end;
