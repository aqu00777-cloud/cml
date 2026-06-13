Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);
' -Name NativeMethods -Namespace Win32

function Move-Absolute { param($rx, $ry); [Win32.NativeMethods]::mouse_event(0x8001, $rx, $ry, 0, 0) }
Move-Absolute 32767 32767
