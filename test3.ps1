Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
' -Name NativeMethods -Namespace Win32

function Click-Left { param($x, $y); [Win32.NativeMethods]::SetCursorPos($x, $y); [Win32.NativeMethods]::mouse_event(2, 0, 0, 0, 0); [Win32.NativeMethods]::mouse_event(4, 0, 0, 0, 0) }
Click-Left 100 100
