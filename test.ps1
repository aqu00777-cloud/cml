Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
' -Name Win32 -Namespace Native
function Click-Left { param($x, $y); [Native.Win32]::SetCursorPos($x, $y); [Native.Win32]::mouse_event(2, 0, 0, 0, 0); [Native.Win32]::mouse_event(4, 0, 0, 0, 0) }
Click-Left 100 100
