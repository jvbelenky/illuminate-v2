; Inno Setup script for Illuminate Desktop
; Requires Inno Setup 6+ (https://jrsoftware.org/isinfo.php)

[Setup]
AppId={{E8F1A2B3-C4D5-6E7F-8901-2A3B4C5D6E7F}
AppName=Illuminate
AppVersion=1.0.0
AppPublisher=UVC
DefaultDirName={autopf}\Illuminate
DefaultGroupName=Illuminate
OutputDir=output
OutputBaseFilename=illuminate-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Bundle everything from the PyInstaller one-dir output
Source: "dist\illuminate\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Illuminate"; Filename: "{app}\illuminate.exe"
Name: "{group}\{cm:UninstallProgram,Illuminate}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Illuminate"; Filename: "{app}\illuminate.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\illuminate.exe"; Description: "{cm:LaunchProgram,Illuminate}"; Flags: nowait postinstall skipifsilent
