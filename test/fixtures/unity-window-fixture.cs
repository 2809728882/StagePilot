// Native Win32 regression fixture, NOT a substitute for the actual Unity application.
using System;
using System.Runtime.InteropServices;
using System.Threading;

class UnityWindowFixture {
    delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct WndClass { public uint style; public WndProc proc; public int clsExtra, wndExtra;
        public IntPtr instance, icon, cursor, background; public string menu, name; }
    [StructLayout(LayoutKind.Sequential)]
    struct Message { public IntPtr h; public uint m; public IntPtr w,l; public uint time; public int x,y; }
    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public int left,top,right,bottom; }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref WndClass c);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr p,IntPtr menu,IntPtr instance,IntPtr param);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool GetMessage(out Message m,IntPtr h,uint min,uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message m);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr h,int i);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
    static WndProc callback = Proc;
    static IntPtr unity, browser, other, hold;
    static bool HoldAboveUnity() {
        for(IntPtr h=GetTopWindow(IntPtr.Zero);h!=IntPtr.Zero;h=GetWindow(h,2)) {
            if(h==hold) return true;
            if(h==unity) return false;
        }
        return false;
    }
    static IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l) {
        if(m == 0x8001) { PostQuitMessage(0); return IntPtr.Zero; }
        return DefWindowProc(h,m,w,l);
    }
    static void Register(string name) {
        WndClass c = new WndClass(); c.name=name; c.proc=callback;
        if(RegisterClass(ref c)==0) throw new Exception("RegisterClass failed");
    }
    static string State(IntPtr h) {
        Rect r; GetWindowRect(h,out r);
        return "{\"topmost\":"+(((GetWindowLong(h,-20)&8)!=0)?"true":"false")+
            ",\"minimized\":"+(IsIconic(h)?"true":"false")+
            ",\"rect\":["+r.left+","+r.top+","+r.right+","+r.bottom+"]}";
    }
    static void Main() {
        Register("UnityWndClass"); Register("StagePilotTestTarget");
        unity=CreateWindowEx(8,"UnityWndClass","StagePilot regression Unity",0x90000000,30,30,460,320,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        browser=CreateWindowEx(0,"StagePilotTestTarget","StagePilot regression target",0x10CF0000,60,60,340,200,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        other=CreateWindowEx(8,"StagePilotTestTarget","StagePilot regression unrelated",0x90000000,500,30,80,60,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        hold=CreateWindowEx(8,"StagePilotTestTarget","StagePilot regression hold",0x80000000,30,30,460,320,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        if(unity==IntPtr.Zero || browser==IntPtr.Zero || other==IntPtr.Zero) throw new Exception("CreateWindowEx failed");
        Console.WriteLine("{\"processId\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"unity\":\""+unity.ToInt64()+"\",\"browser\":\""+browser.ToInt64()+"\",\"hold\":\""+hold.ToInt64()+"\"}");
        new Thread(delegate() {
            string line;
            while((line=Console.ReadLine())!=null) {
                if(line=="exit") break;
                if(line=="hold") ShowWindow(hold,4);
                if(line=="state") Console.WriteLine("{\"unity\":"+State(unity)+",\"other\":"+State(other)+",\"holdAboveUnity\":"+(HoldAboveUnity()?"true":"false")+",\"foreground\":\""+GetForegroundWindow().ToInt64()+"\"}");
            }
            PostMessage(unity,0x8001,IntPtr.Zero,IntPtr.Zero);
        }) { IsBackground=true }.Start();
        Message msg;
        while(GetMessage(out msg,IntPtr.Zero,0,0)) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
    }
}
