#include "dssh_chrome.h"
#include <windows.h>
#include <shobjidl.h>
#include <shlguid.h>
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace {
constexpr wchar_t className[] = L"DuoSshRdpConnectionBar";
constexpr const char* propertyName = "dssh.chrome.native";
struct Chrome {
    SDL_Window* desktop = nullptr;
    HWND owner = nullptr, bar = nullptr, title = nullptr;
    HWND buttons[4] = {};
    HFONT font = nullptr;
    ITaskbarList2* taskbar = nullptr;
    bool uninitializeCom = false, markedFullscreen = false;
    DsshChromeReveal reveal = {};
};
std::vector<Chrome*> bars;

void tick(Chrome* chrome)
{
    const auto flags = SDL_GetWindowFlags(chrome->desktop);
    const bool active = IsWindowVisible(chrome->owner) && !IsIconic(chrome->owner) &&
        GetAncestor(GetForegroundWindow(), GA_ROOTOWNER) == chrome->owner;
    const bool fullscreen = active && (flags & SDL_WINDOW_FULLSCREEN);
    if (chrome->taskbar && fullscreen != chrome->markedFullscreen) {
        chrome->taskbar->MarkFullscreenWindow(chrome->owner, fullscreen ? TRUE : FALSE);
        chrome->markedFullscreen = fullscreen;
    }
    RECT client = {};
    GetClientRect(chrome->owner, &client);
    MapWindowPoints(chrome->owner, nullptr, reinterpret_cast<POINT*>(&client), 2);
    POINT mouse = {};
    GetCursorPos(&mouse);
    const float scale = std::max(1.0f, SDL_GetDisplayContentScale(SDL_GetDisplayForWindow(chrome->desktop)));
    const int margin = int(8 * scale), height = int(38 * scale);
    const int width = std::max(1, std::min(int(460 * scale), int(client.right - client.left) - margin * 2));
    const RECT frame{client.left + (client.right - client.left - width) / 2, client.top,
                     client.left + (client.right - client.left + width) / 2, client.top + height};
    const bool atEdge = mouse.x >= client.left && mouse.x < client.right &&
        mouse.y >= client.top && mouse.y <= client.top + int(4 * scale);
    const bool visible = dssh_chrome_reveal(&chrome->reveal, active, atEdge, PtInRect(&frame, mouse), SDL_GetTicks());
    if (!visible) { ShowWindow(chrome->bar, SW_HIDE); return; }
    SetWindowPos(chrome->bar, HWND_TOPMOST, frame.left, frame.top, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
    const int buttonWidth = std::min(int(72 * scale), std::max(1, width / 5));
    const int buttonStart = width - buttonWidth * 4 - int(4 * scale);
    MoveWindow(chrome->title, int(10 * scale), int(10 * scale), std::max(0, buttonStart - int(16 * scale)), int(20 * scale), TRUE);
    for (int i = 0; i < 4; i++)
        MoveWindow(chrome->buttons[i], buttonStart + i * buttonWidth, int(4 * scale), buttonWidth, height - int(8 * scale), TRUE);
    SetWindowTextW(chrome->buttons[1], (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? L"还原" : L"最大化");
    SetWindowTextW(chrome->buttons[2], (flags & SDL_WINDOW_FULLSCREEN) ? L"退出全屏" : L"全屏");
}

LRESULT CALLBACK procedure(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam)
{
    if (message == WM_NCCREATE) {
        auto create = reinterpret_cast<CREATESTRUCTW*>(lparam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    }
    auto chrome = reinterpret_cast<Chrome*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (chrome) {
        if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
        if (message == WM_COMMAND && HIWORD(wparam) == BN_CLICKED) {
            const int action = LOWORD(wparam);
            if (action >= 1 && action <= 4)
                dssh_chrome_action(chrome->desktop, DSSH_CHROME_MINIMIZE + action - 1);
            SetFocus(chrome->owner);
            return 0;
        }
        if (message == WM_CLOSE) { ShowWindow(hwnd, SW_HIDE); return 0; }
        if (message == WM_CTLCOLORSTATIC) {
            SetBkMode(reinterpret_cast<HDC>(wparam), TRANSPARENT);
            SetTextColor(reinterpret_cast<HDC>(wparam), GetSysColor(COLOR_WINDOWTEXT));
            return reinterpret_cast<LRESULT>(GetSysColorBrush(COLOR_WINDOW));
        }
    }
    return DefWindowProcW(hwnd, message, wparam, lparam);
}
}

extern "C" void dssh_chrome_attach(SDL_Window* window)
{
    if (!window || SDL_GetPointerProperty(SDL_GetWindowProperties(window), propertyName, nullptr)) return;
    auto owner = static_cast<HWND>(SDL_GetPointerProperty(SDL_GetWindowProperties(window), SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    if (!owner) return;
    WNDCLASSW definition = {};
    definition.lpfnWndProc = procedure;
    definition.hInstance = GetModuleHandleW(nullptr);
    definition.lpszClassName = className;
    definition.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    definition.hbrBackground = GetSysColorBrush(COLOR_WINDOW);
    if (!RegisterClassW(&definition) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return;
    auto chrome = new Chrome;
    chrome->desktop = window; chrome->owner = owner;
    chrome->bar = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
        className, L"远程桌面控制栏", WS_POPUP | WS_BORDER, 0, 0, 460, 38, owner, nullptr, definition.hInstance, chrome);
    if (!chrome->bar) { delete chrome; return; }
    const char* title = SDL_GetWindowTitle(window);
    if (!title) title = "";
    int length = MultiByteToWideChar(CP_UTF8, 0, title, -1, nullptr, 0);
    std::wstring caption(std::max(1, length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, title, -1, caption.data(), length);
    chrome->title = CreateWindowExW(0, L"STATIC", caption.c_str(), WS_CHILD | WS_VISIBLE | SS_ENDELLIPSIS,
        0, 0, 0, 0, chrome->bar, nullptr, definition.hInstance, nullptr);
    const wchar_t* labels[] = {L"最小化", L"最大化", L"全屏", L"关闭"};
    const float scale = std::max(1.0f, SDL_GetDisplayContentScale(SDL_GetDisplayForWindow(window)));
    chrome->font = CreateFontW(-int(12 * scale), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    SendMessageW(chrome->title, WM_SETFONT, reinterpret_cast<WPARAM>(chrome->font), TRUE);
    for (int i = 0; i < 4; i++) {
        chrome->buttons[i] = CreateWindowExW(0, L"BUTTON", labels[i], WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
            0, 0, 0, 0, chrome->bar, reinterpret_cast<HMENU>(static_cast<INT_PTR>(i + 1)), definition.hInstance, nullptr);
        SendMessageW(chrome->buttons[i], WM_SETFONT, reinterpret_cast<WPARAM>(chrome->font), TRUE);
    }
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    chrome->uninitializeCom = SUCCEEDED(initialized);
    if (SUCCEEDED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_ITaskbarList2, reinterpret_cast<void**>(&chrome->taskbar))))
        if (FAILED(chrome->taskbar->HrInit())) { chrome->taskbar->Release(); chrome->taskbar = nullptr; }
    SDL_SetPointerProperty(SDL_GetWindowProperties(window), propertyName, chrome);
    bars.push_back(chrome);
}

extern "C" void dssh_chrome_detach(SDL_Window* window)
{
    if (!window) return;
    auto chrome = static_cast<Chrome*>(SDL_GetPointerProperty(SDL_GetWindowProperties(window), propertyName, nullptr));
    if (!chrome) return;
    SDL_ClearProperty(SDL_GetWindowProperties(window), propertyName);
    bars.erase(std::remove(bars.begin(), bars.end(), chrome), bars.end());
    if (chrome->taskbar) { chrome->taskbar->MarkFullscreenWindow(chrome->owner, FALSE); chrome->taskbar->Release(); }
    DestroyWindow(chrome->bar);
    if (chrome->font) DeleteObject(chrome->font);
    if (chrome->uninitializeCom) CoUninitialize();
    delete chrome;
}

extern "C" void dssh_chrome_tick(void)
{
    static Uint64 previous = 0;
    const Uint64 now = SDL_GetTicks();
    if (now - previous < 50) return;
    previous = now;
    for (auto chrome : bars) tick(chrome);
}

#ifdef DSSH_CHROME_TESTING
extern "C" bool dssh_chrome_test_visible(SDL_Window* window)
{
    auto chrome = static_cast<Chrome*>(SDL_GetPointerProperty(SDL_GetWindowProperties(window), propertyName, nullptr));
    return chrome && IsWindowVisible(chrome->bar);
}
extern "C" bool dssh_chrome_test_click(SDL_Window* window, int action)
{
    auto chrome = static_cast<Chrome*>(SDL_GetPointerProperty(SDL_GetWindowProperties(window), propertyName, nullptr));
    const int index = action - DSSH_CHROME_MINIMIZE;
    if (!chrome || index < 0 || index >= 4) return false;
    SendMessageW(chrome->buttons[index], BM_CLICK, 0, 0);
    return true;
}
#endif
