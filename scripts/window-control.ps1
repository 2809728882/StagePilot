param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Launch', 'List', 'Focus', 'Confirm', 'Close', 'Begin', 'Commit', 'Rollback', 'Restore')]
    [string]$Action,
    [string]$Command = '',
    [string]$Arguments = '',
    [string]$ProcessName = '',
    [int]$ProcessId = 0,
    [long]$WindowHandle = 0,
    [int]$TimeoutSeconds = 12,
    [string]$StatePath = '',
    [long]$OverlayHandle = 0,
    [int]$DisplayX = 0,
    [int]$DisplayY = 0,
    [int]$DisplayWidth = 0,
    [int]$DisplayHeight = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class StagePilotWindow {
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_NOACTIVATE = 0x0010;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int index);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    public static bool IsUnityWindow(IntPtr hWnd) {
        StringBuilder name = new StringBuilder(256);
        GetClassName(hWnd, name, name.Capacity);
        return name.ToString() == "UnityWndClass";
    }
    public static bool IsTopmost(IntPtr hWnd) { return (GetWindowLong(hWnd, -20) & 8) != 0; }
    public static bool SetTopmost(IntPtr hWnd, bool enabled) {
        return SetWindowPos(hWnd, new IntPtr(enabled ? -1 : -2), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    public static bool RestoreTopmostBehindHold(IntPtr hWnd, IntPtr hold) {
        IntPtr after = hold != IntPtr.Zero && IsWindow(hold) && IsWindowVisible(hold) && IsTopmost(hold)
            ? hold : new IntPtr(-1);
        return SetWindowPos(hWnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    public static bool OverlapsDisplay(IntPtr hWnd, int x, int y, int width, int height) {
        Rect rect;
        if (width <= 0 || height <= 0 || !GetWindowRect(hWnd, out rect)) return false;
        return rect.Left < x + width && rect.Right > x && rect.Top < y + height && rect.Bottom > y;
    }
    public static bool IsMaximized(IntPtr hWnd) { return IsZoomed(hWnd); }
    public static bool IsMinimized(IntPtr hWnd) { return IsIconic(hWnd); }

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    private static extern int DwmFlush();

    public static IntPtr[] GetVisibleWindows() {
        List<IntPtr> handles = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) handles.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return handles.ToArray();
    }

    public static string GetTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return String.Empty;
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static uint GetProcessId(IntPtr hWnd) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        return processId;
    }

    public static IntPtr GetForegroundHandle() {
        return GetForegroundWindow();
    }

    public static bool MinimizeWindow(IntPtr hWnd) {
        return hWnd != IntPtr.Zero && ShowWindowAsync(hWnd, 6); // SW_MINIMIZE
    }

    public static bool RequestClose(IntPtr hWnd) {
        return hWnd != IntPtr.Zero && IsWindow(hWnd) && PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
    }

    public static bool ActivateWindow(IntPtr hWnd, bool maximize) {
        if (hWnd == IntPtr.Zero) return false;

        IntPtr foreground = GetForegroundWindow();
        uint ignored;
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
        uint targetThread = GetWindowThreadProcessId(hWnd, out ignored);
        uint currentThread = GetCurrentThreadId();
        bool attachedForeground = false;
        bool attachedTarget = false;

        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread) {
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            }

            if (IsIconic(hWnd)) ShowWindowAsync(hWnd, 9); // SW_RESTORE
            // Unity can have a custom borderless multi-screen size. Never resize it.
            if (maximize && !IsUnityWindow(hWnd) && !IsZoomed(hWnd)) ShowWindowAsync(hWnd, 3); // SW_MAXIMIZE
            // HWND_TOP keeps the target above ordinary apps but below StagePilot's topmost hold frame.
            SetWindowPos(hWnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            BringWindowToTop(hWnd);
            SetFocus(hWnd);
            SetForegroundWindow(hWnd);
        } finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }

        DwmFlush();
        System.Threading.Thread.Sleep(maximize ? 150 : 55);
        return GetForegroundWindow() == hWnd;
    }
}
'@

$windowState = @{ records = @(); checkpoint = @(); transaction = $false }
if ($StatePath -and (Test-Path -LiteralPath $StatePath)) {
    $savedState = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    $windowState.records = @($savedState.records)
    $windowState.checkpoint = @($savedState.checkpoint)
    $windowState.transaction = [bool]$savedState.transaction
}

function Save-WindowState {
    if ($StatePath) {
        $temporaryStatePath = $StatePath + '.' + $PID + '.tmp'
        [IO.File]::WriteAllText($temporaryStatePath, ($windowState | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $StatePath) { [IO.File]::Replace($temporaryStatePath, $StatePath, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($temporaryStatePath, $StatePath) }
    }
}

function Test-WindowRecord($record) {
    $handle = [IntPtr]::new([long]$record.handle)
    if (-not [StagePilotWindow]::IsWindow($handle) -or -not [StagePilotWindow]::IsUnityWindow($handle)) { return $false }
    if ([StagePilotWindow]::GetProcessId($handle) -ne [int]$record.processId) { return $false }
    try {
        $owner = Get-Process -Id $record.processId -ErrorAction Stop
        return $owner.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.started
    } catch { return $false }
}

function Restore-WindowRecord($record) {
    if (-not (Test-WindowRecord $record)) { return }
    $handle = [IntPtr]::new([long]$record.handle)
    if ([StagePilotWindow]::IsMinimized($handle)) {
        # ShowWindow can raise a restored topmost window even without activation.
        # Restore it in the ordinary band first so it cannot jump over the hold frame.
        if (-not [StagePilotWindow]::SetTopmost($handle, $false)) { throw 'Unable to prepare Unity window recovery.' }
        [StagePilotWindow]::ShowWindowAsync($handle, [int]$record.showCommand) | Out-Null
        Start-Sleep -Milliseconds 150
        if ([StagePilotWindow]::IsMinimized($handle)) { throw 'Unable to restore the Unity window visibility.' }
    }
    if (-not [StagePilotWindow]::RestoreTopmostBehindHold($handle, [IntPtr]::new($OverlayHandle))) { throw 'Unable to restore the Unity window topmost state.' }
}

function Remember-UnityWindow([IntPtr]$handle) {
    $record = $windowState.records | Where-Object { [long]$_.handle -eq $handle.ToInt64() } | Select-Object -First 1
    if (-not $record) {
        $ownerId = [int][StagePilotWindow]::GetProcessId($handle)
        $owner = Get-Process -Id $ownerId -ErrorAction Stop
        $record = [pscustomobject]@{
            handle = $handle.ToInt64().ToString()
            processId = $ownerId
            started = $owner.StartTime.ToUniversalTime().Ticks.ToString()
            showCommand = $(if ([StagePilotWindow]::IsMaximized($handle)) { 3 } else { 4 })
        }
        $windowState.records = @($windowState.records) + $record
        Save-WindowState # Journal before changing any external window.
    }
}

function Suspend-UnityBlockers([IntPtr]$targetHandle) {
    if (-not $StatePath) { return }
    # Prepare selected Unity underneath the topmost hold frame too. Restore its topmost
    # state only after final activation, behind the hold HWND, without reactivating it.
    if ([StagePilotWindow]::IsUnityWindow($targetHandle) -and [StagePilotWindow]::IsTopmost($targetHandle)) {
        Remember-UnityWindow $targetHandle
        if (-not [StagePilotWindow]::SetTopmost($targetHandle, $false)) { throw 'Unable to prepare the Unity window underneath the hold frame.' }
    }
    foreach ($handle in [StagePilotWindow]::GetVisibleWindows()) {
        if ($handle -eq $targetHandle -or -not [StagePilotWindow]::IsUnityWindow($handle)) { continue }
        if ([StagePilotWindow]::IsMinimized($handle) -or -not [StagePilotWindow]::IsTopmost($handle)) { continue }
        if (-not [StagePilotWindow]::OverlapsDisplay($handle, $DisplayX, $DisplayY, $DisplayWidth, $DisplayHeight)) { continue }
        Remember-UnityWindow $handle
        if (-not [StagePilotWindow]::SetTopmost($handle, $false)) { throw 'Unable to release the Unity window topmost state. Check administrator privileges.' }
        # This also releases exclusive fullscreen/focus reclaim, underneath the hold frame.
        [StagePilotWindow]::MinimizeWindow($handle) | Out-Null
        Start-Sleep -Milliseconds 100
        if (-not [StagePilotWindow]::IsMinimized($handle)) { throw 'The Unity window refused to leave fullscreen.' }
    }
}

function Test-UnityBlockers([IntPtr]$targetHandle) {
    foreach ($handle in [StagePilotWindow]::GetVisibleWindows()) {
        if ($handle -ne $targetHandle -and [StagePilotWindow]::IsUnityWindow($handle) -and
            -not [StagePilotWindow]::IsMinimized($handle) -and [StagePilotWindow]::IsTopmost($handle) -and
            [StagePilotWindow]::OverlapsDisplay($handle, $DisplayX, $DisplayY, $DisplayWidth, $DisplayHeight)) { return $true }
    }
    return $false
}

if ($Action -in @('Begin', 'Commit', 'Rollback', 'Restore')) {
    if (-not $StatePath) { throw 'StatePath is required for window state management.' }
    if ($Action -eq 'Begin') {
        if ($windowState.transaction) { throw 'A window switch transaction is already active.' }
        $windowState.checkpoint = @($windowState.records)
        $windowState.transaction = $true
    } elseif ($Action -eq 'Rollback') {
        if ($windowState.transaction) {
            foreach ($record in @($windowState.records)) {
                if (-not ($windowState.checkpoint | Where-Object { $_.handle -eq $record.handle })) { Restore-WindowRecord $record }
            }
            foreach ($record in @($windowState.checkpoint)) {
                if (Test-WindowRecord $record) {
                    $handle = [IntPtr]::new([long]$record.handle)
                    if (-not [StagePilotWindow]::SetTopmost($handle, $false)) { throw 'Unable to roll back the Unity window state.' }
                    [StagePilotWindow]::MinimizeWindow($handle) | Out-Null
                }
            }
            $windowState.records = @($windowState.checkpoint)
        }
        $windowState.checkpoint = @(); $windowState.transaction = $false
    } elseif ($Action -eq 'Restore') {
        foreach ($record in @($windowState.records) + @($windowState.checkpoint)) { Restore-WindowRecord $record }
        $windowState.records = @(); $windowState.checkpoint = @(); $windowState.transaction = $false
    } else {
        $windowState.checkpoint = @(); $windowState.transaction = $false
    }
    Save-WindowState
    '{"ok":true}'
    exit 0
}

function Resolve-TargetWindow {
    param(
        [System.Diagnostics.Process]$TargetProcess,
        [long]$RequestedHandle = 0
    )

    if ($RequestedHandle -ne 0) {
        $handle = [IntPtr]::new($RequestedHandle)
        if (-not [StagePilotWindow]::IsWindow($handle)) { throw 'The selected window is no longer available.' }
        if ([StagePilotWindow]::GetProcessId($handle) -ne $TargetProcess.Id) { throw 'The selected window does not belong to the requested process.' }
        return $handle
    }

    $TargetProcess.Refresh()
    $mainHandle = $TargetProcess.MainWindowHandle
    if ($null -eq $mainHandle -or $mainHandle -eq [IntPtr]::Zero) { throw 'The selected process does not have a visible window.' }
    return [IntPtr]$mainHandle
}

function Invoke-WindowActivation {
    param(
        [System.Diagnostics.Process]$TargetProcess,
        [long]$RequestedHandle = 0,
        [bool]$Maximize = $true
    )

    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try { $TargetProcess.Refresh() } catch { }
        $handle = Resolve-TargetWindow -TargetProcess $TargetProcess -RequestedHandle $RequestedHandle
        Suspend-UnityBlockers $handle
        if ($handle -ne 0 -and [StagePilotWindow]::ActivateWindow($handle, $Maximize) -and -not (Test-UnityBlockers $handle)) {
            return $handle
        }
        Start-Sleep -Milliseconds (90 * $attempt)
    }

    throw 'Windows refused to activate the target window. If the target runs as administrator, start StagePilot with the same privilege level.'
}

if ($Action -eq 'List') {
    $windows = [StagePilotWindow]::GetVisibleWindows() | ForEach-Object {
        $handle = $_
        $ownerId = [int][StagePilotWindow]::GetProcessId($handle)
        try {
            $owner = Get-Process -Id $ownerId -ErrorAction Stop
            [pscustomobject]@{
                processId = $ownerId
                processName = $owner.ProcessName
                title = [StagePilotWindow]::GetTitle($handle)
                windowHandle = $handle.ToInt64().ToString()
            }
        } catch {
            # The window closed while it was being enumerated.
        }
    }
    @($windows) | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq 'Focus') {
    if ($ProcessId -le 0) { throw 'ProcessId is required for Focus.' }
    $target = Get-Process -Id $ProcessId -ErrorAction Stop
    $handle = Invoke-WindowActivation -TargetProcess $target -RequestedHandle $WindowHandle
    [pscustomobject]@{
        processId = $target.Id
        processName = $target.ProcessName
        title = [StagePilotWindow]::GetTitle($handle)
        windowHandle = $handle.ToInt64().ToString()
    } | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq 'Confirm') {
    if ($ProcessId -le 0) { throw 'ProcessId is required for Confirm.' }
    $target = Get-Process -Id $ProcessId -ErrorAction Stop
    $targetHandle = Resolve-TargetWindow -TargetProcess $target -RequestedHandle $WindowHandle
    # Foreground ownership alone cannot detect a topmost Unity window covering the browser.
    $handle = Invoke-WindowActivation -TargetProcess $target -RequestedHandle $WindowHandle -Maximize $false
    foreach ($record in @($windowState.records)) {
        if ([long]$record.handle -eq $handle.ToInt64()) {
            Restore-WindowRecord $record
            $windowState.records = @($windowState.records | Where-Object { $_.handle -ne $record.handle })
            Save-WindowState
        }
    }
    [pscustomobject]@{
        processId = $target.Id
        processName = $target.ProcessName
        title = [StagePilotWindow]::GetTitle($handle)
        windowHandle = $handle.ToInt64().ToString()
    } | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq 'Close') {
    if ($ProcessId -le 0) { throw 'ProcessId is required for Close.' }
    $target = Get-Process -Id $ProcessId -ErrorAction Stop
    $handle = Resolve-TargetWindow -TargetProcess $target -RequestedHandle $WindowHandle
    $title = [StagePilotWindow]::GetTitle($handle)
    if (-not [StagePilotWindow]::RequestClose($handle)) { throw 'Windows rejected the close request.' }
    [pscustomobject]@{
        processId = $target.Id
        processName = $target.ProcessName
        title = $title
        windowHandle = $handle.ToInt64().ToString()
        requested = $true
    } | ConvertTo-Json -Compress
    exit 0
}

if (-not $Command) {
    throw 'Command is required for Launch.'
}

$existing = $null
if ($ProcessName) {
    $existing = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Where-Object { $null -ne $_.MainWindowHandle -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Select-Object -First 1
}

if ($existing) {
    $process = $existing
} else {
    $startArgs = @{
        FilePath = $Command
        PassThru = $true
        # StagePilot's existing-output layer already hides startup from the audience.
        # Starting minimized can race with a later maximize and leave only a flashing taskbar icon.
        WindowStyle = 'Normal'
    }
    if ($Arguments) {
        $startArgs.ArgumentList = $Arguments
    }
    $process = Start-Process @startArgs
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$lastHandle = [IntPtr]::Zero
$stableSamples = 0
do {
    Start-Sleep -Milliseconds 140
    try {
        $process.Refresh()
        $currentHandle = $process.MainWindowHandle
        if ($null -ne $currentHandle -and $currentHandle -ne [IntPtr]::Zero -and $process.Responding) {
            if ($currentHandle -eq $lastHandle) {
                $stableSamples++
            } else {
                $lastHandle = $currentHandle
                $stableSamples = 1
            }
            if ($stableSamples -ge 3) { break }
        }
    } catch {
        # Launcher processes such as calc.exe may exit after handing off to the real app.
    }
    if ($ProcessName) {
        $candidate = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
            Where-Object { $null -ne $_.MainWindowHandle -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Select-Object -First 1
        if ($candidate -and $candidate.Id -ne $process.Id) {
            $process = $candidate
            $lastHandle = [IntPtr]::Zero
            $stableSamples = 0
        }
    }
} while ([DateTime]::UtcNow -lt $deadline)

if ($null -eq $process.MainWindowHandle -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Timed out waiting for a window from $Command"
}

# The StagePilot output layer remains visible until this returns successfully.
$handle = Invoke-WindowActivation -TargetProcess $process

[pscustomobject]@{
    processId = $process.Id
    processName = $process.ProcessName
    title = [StagePilotWindow]::GetTitle($handle)
    windowHandle = $handle.ToInt64().ToString()
} | ConvertTo-Json -Compress
