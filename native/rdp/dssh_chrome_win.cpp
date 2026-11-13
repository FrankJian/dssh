#include "dssh_chrome.h"
#include "dssh_visibility_state.h"
#include "dssh_chrome_visual.h"
#include <windows.h>
#include <commctrl.h>
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
    HWND owner = nullptr, bar = nullptr, title = nullptr, tooltip = nullptr;
    WNDPROC buttonProcedure = nullptr;
    int hovered = -1;
    float fontScale = 0;
    HWND buttons[4] = {};
    HFONT font = nullptr;
    ITaskbarList2* taskbar = nullptr;
    bool uninitializeCom = false, markedFullscreen = false;
    DsshChromeReveal reveal = {};
    DsshChromePosition position = {0.5f, 0};
    bool dragging = false;
    POINT grab = {};
};
std::vector<Chrome*> bars;

void layoutControls(Chrome* chrome, int width, int height, float scale)
{
    const int buttonWidth = std::min(int(32 * scale), std::max(1, (width - int(16 * scale)) / 4));
    const int buttonStart = width - buttonWidth * 4 - int(18 * scale);
    MoveWindow(chrome->title, int(50 * scale), int(12 * scale), std::max(0, buttonStart - int(62 * scale)), int(16 * scale), TRUE);
    if (chrome->fontScale != scale) {
        HFONT previous = chrome->font;
        chrome->font = CreateFontW(-int(12 * scale), 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        SendMessageW(chrome->title, WM_SETFONT, reinterpret_cast<WPARAM>(chrome->font), TRUE);
        if (previous) DeleteObject(previous);
        chrome->fontScale = scale;
    }
    for (int i = 0; i < 4; i++)
        MoveWindow(chrome->buttons[i], buttonStart + i * (buttonWidth + int(2 * scale)) + (i == 3 ? int(4 * scale) : 0), int(4 * scale), buttonWidth, height - int(8 * scale), TRUE);
}

void tick(Chrome* chrome)
{
    const auto flags = SDL_GetWindowFlags(chrome->desktop);
    const bool active = IsWindowVisible(chrome->owner) && !IsIconic(chrome->owner) &&
        GetAncestor(GetForegroundWindow(), GA_ROOTOWNER) == chrome->owner;
    if (!active && chrome->dragging) {
        chrome->dragging = false;
        if (GetCapture() == chrome->bar) ReleaseCapture();
    }
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
    const int margin = int(8 * scale), height = int(40 * scale);
    const int width = std::max(1, std::min(int(440 * scale), int(client.right - client.left) - margin * 2));
    const auto local = dssh_chrome_frame(chrome->position, float(client.right - client.left),
        float(client.bottom - client.top), float(width), float(height));
    const RECT frame{client.left + int(local.x), client.top + int(local.y),
                     client.left + int(local.x + local.w), client.top + int(local.y + local.h)};
    const bool atEdge = mouse.x >= client.left && mouse.x < client.right &&
        mouse.y >= client.top && mouse.y <= client.top + int(4 * scale);
    const bool visible = dssh_chrome_reveal(&chrome->reveal, active, atEdge || chrome->dragging, PtInRect(&frame, mouse), SDL_GetTicks());
    if (!visible) { chrome->hovered = -1; ShowWindow(chrome->tooltip, SW_HIDE); ShowWindow(chrome->bar, SW_HIDE); return; }
    SetWindowPos(chrome->bar, HWND_TOPMOST, frame.left, frame.top, frame.right - frame.left, frame.bottom - frame.top,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
    layoutControls(chrome, width, height, scale);
    SetWindowTextW(chrome->buttons[1], (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? L"还原" : L"最大化");
    SetWindowTextW(chrome->buttons[2], (flags & SDL_WINDOW_FULLSCREEN) ? L"退出全屏" : L"全屏");
    const wchar_t* tips[] = {L"最小化", (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? L"还原" : L"最大化",
        (flags & SDL_WINDOW_FULLSCREEN) ? L"退出全屏" : L"全屏", L"关闭"};
    for (int i = 0; i < 4; ++i) {
        TOOLINFOW tool = {}; tool.cbSize = sizeof(tool); tool.hwnd = chrome->bar;
        tool.uId = reinterpret_cast<UINT_PTR>(chrome->buttons[i]); tool.lpszText = const_cast<wchar_t*>(tips[i]);
        SendMessageW(chrome->tooltip, TTM_UPDATETIPTEXTW, 0, reinterpret_cast<LPARAM>(&tool));
        InvalidateRect(chrome->buttons[i], nullptr, FALSE);
    }
    InvalidateRect(chrome->bar, nullptr, FALSE);
}

COLORREF color(unsigned rgb) { return RGB((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
DsshChromePalette palette() { return SDL_GetSystemTheme() == SDL_SYSTEM_THEME_LIGHT ? dssh_chrome_light : dssh_chrome_dark; }
struct Drawing { HDC dc; float x, y, size; };
void line(void* context, float x1, float y1, float x2, float y2)
{
    auto draw = static_cast<Drawing*>(context);
    MoveToEx(draw->dc, int(std::lround(draw->x + x1 * draw->size / 24)), int(std::lround(draw->y + y1 * draw->size / 24)), nullptr);
    LineTo(draw->dc, int(std::lround(draw->x + x2 * draw->size / 24)), int(std::lround(draw->y + y2 * draw->size / 24)));
}
void glyph(HDC dc, int icon, float x, float y, float size, unsigned rgb, float scale)
{
    HPEN pen = CreatePen(PS_SOLID, std::max(1, int(std::lround(1.35f * scale))), color(rgb));
    auto previous = SelectObject(dc, pen);
    Drawing draw{dc, x, y, size}; dssh_chrome_glyph(icon, line, &draw);
    SelectObject(dc, previous); DeleteObject(pen);
}
void rounded(HDC dc, RECT rect, unsigned fill, unsigned border, int radius)
{
    HBRUSH brush = CreateSolidBrush(color(fill)); HPEN pen = CreatePen(PS_SOLID, 1, color(border));
    auto oldBrush = SelectObject(dc, brush); auto oldPen = SelectObject(dc, pen);
    RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
    SelectObject(dc, oldBrush); SelectObject(dc, oldPen); DeleteObject(brush); DeleteObject(pen);
}
LRESULT CALLBACK buttonProcedure(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam)
{
    auto chrome = reinterpret_cast<Chrome*>(GetWindowLongPtrW(GetParent(hwnd), GWLP_USERDATA));
    if (!chrome || !chrome->buttonProcedure) return DefWindowProcW(hwnd, message, wparam, lparam);
    const int index = GetDlgCtrlID(hwnd) - 1;
    if (message == WM_MOUSEMOVE) {
        if (chrome->hovered != index) { chrome->hovered = index; InvalidateRect(hwnd, nullptr, FALSE); }
        TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, hwnd, 0}; TrackMouseEvent(&track);
    }
    if (message == WM_MOUSELEAVE) { chrome->hovered = -1; InvalidateRect(hwnd, nullptr, FALSE); }
    if (message == WM_SETFOCUS || message == WM_KILLFOCUS) InvalidateRect(hwnd, nullptr, FALSE);
    return CallWindowProcW(chrome->buttonProcedure, hwnd, message, wparam, lparam);
}

LRESULT CALLBACK procedure(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam)
{
    if (message == WM_NCCREATE) {
        auto create = reinterpret_cast<CREATESTRUCTW*>(lparam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    }
    auto chrome = reinterpret_cast<Chrome*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (chrome) {
        if (message == WM_SIZE) {
            const float scale = std::max(1.0f, SDL_GetDisplayContentScale(SDL_GetDisplayForWindow(chrome->desktop)));
            HRGN region = CreateRoundRectRgn(0, 0, LOWORD(lparam) + 1, HIWORD(lparam) + 1, int(10 * scale), int(10 * scale));
            if (!SetWindowRgn(hwnd, region, TRUE)) DeleteObject(region);
        }
        if (message == WM_ERASEBKGND) return 1;
        if (message == WM_SETCURSOR && reinterpret_cast<HWND>(wparam) == hwnd && LOWORD(lparam) == HTCLIENT) {
            SetCursor(LoadCursorW(nullptr, IDC_SIZEALL)); return TRUE;
        }
        if (message == WM_PAINT) {
            PAINTSTRUCT paint = {}; HDC dc = BeginPaint(hwnd, &paint);
            RECT rect = {}; GetClientRect(hwnd, &rect);
            const auto p = palette();
            const float scale = std::max(1.0f, SDL_GetDisplayContentScale(SDL_GetDisplayForWindow(chrome->desktop)));
            rounded(dc, rect, p.surface, p.border, int(10 * scale));
            glyph(dc, DSSH_GLYPH_GRIP, 6 * scale, 12 * scale, 16 * scale, p.muted, scale);
            glyph(dc, DSSH_GLYPH_MONITOR, 26 * scale, 12 * scale, 16 * scale, p.accent, scale);
            RECT separator{rect.right - int(153 * scale), int(11 * scale), rect.right - int(153 * scale) + 1, rect.bottom - int(11 * scale)};
            SetDCBrushColor(dc, color(p.border)); FillRect(dc, &separator, static_cast<HBRUSH>(GetStockObject(DC_BRUSH)));
            EndPaint(hwnd, &paint); return 0;
        }
        if (message == WM_DRAWITEM) {
            auto item = reinterpret_cast<DRAWITEMSTRUCT*>(lparam);
            const int index = int(item->CtlID) - 1;
            if (index < 0 || index >= 4) return FALSE;
            const auto p = palette();
            const float scale = std::max(1.0f, SDL_GetDisplayContentScale(SDL_GetDisplayForWindow(chrome->desktop)));
            const bool hot = chrome->hovered == index || (item->itemState & ODS_SELECTED);
            const unsigned background = hot ? (index == 3 ? p.dangerHover : ((item->itemState & ODS_SELECTED) ? p.pressed : p.hover)) : p.surface;
            SetDCBrushColor(item->hDC, color(p.surface)); FillRect(item->hDC, &item->rcItem, static_cast<HBRUSH>(GetStockObject(DC_BRUSH)));
            RECT box = item->rcItem; InflateRect(&box, -1, -1);
            rounded(item->hDC, box, background, (item->itemState & ODS_FOCUS) ? p.accent : background, int(8 * scale));
            const auto flags = SDL_GetWindowFlags(chrome->desktop);
            const int icons[] = {DSSH_GLYPH_MINIMIZE, (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? DSSH_GLYPH_RESTORE : DSSH_GLYPH_MAXIMIZE,
                (flags & SDL_WINDOW_FULLSCREEN) ? DSSH_GLYPH_COLLAPSE : DSSH_GLYPH_EXPAND, DSSH_GLYPH_CLOSE};
            const float size = 18 * scale;
            glyph(item->hDC, icons[index], (item->rcItem.right - size) / 2, (item->rcItem.bottom - size) / 2,
                size, index == 3 ? (hot ? p.onDanger : p.danger) : p.text, scale);
            return TRUE;
        }
        if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
        if (message == WM_LBUTTONDOWN) {
            if (dssh_desktop_locked()) return 0;
            RECT frame = {};
            GetWindowRect(hwnd, &frame);
            chrome->grab = {short(LOWORD(lparam)), short(HIWORD(lparam))};
            ClientToScreen(hwnd, &chrome->grab);
            chrome->grab.x -= frame.left;
            chrome->grab.y -= frame.top;
            chrome->dragging = true;
            dssh_record_activity(chrome->desktop);
            SetCapture(hwnd);
            return 0;
        }
        if (message == WM_MOUSEMOVE && chrome->dragging) {
            if (dssh_desktop_locked()) return 0;
            POINT mouse = {short(LOWORD(lparam)), short(HIWORD(lparam))};
            ClientToScreen(hwnd, &mouse);
            ScreenToClient(chrome->owner, &mouse);
            RECT client = {}, frame = {};
            GetClientRect(chrome->owner, &client);
            GetWindowRect(hwnd, &frame);
            dssh_chrome_move(&chrome->position, float(mouse.x - chrome->grab.x),
                float(mouse.y - chrome->grab.y), float(client.right - (frame.right - frame.left)),
                float(client.bottom - (frame.bottom - frame.top)));
            dssh_record_activity(chrome->desktop);
            tick(chrome);
            return 0;
        }
        if (message == WM_LBUTTONUP || message == WM_CANCELMODE || message == WM_CAPTURECHANGED) {
            chrome->dragging = false;
            if (GetCapture() == hwnd) ReleaseCapture();
            return 0;
        }
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
            SetTextColor(reinterpret_cast<HDC>(wparam), color(palette().text));
            SetDCBrushColor(reinterpret_cast<HDC>(wparam), color(palette().surface));
            return reinterpret_cast<LRESULT>(GetStockObject(DC_BRUSH));
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
        className, L"远程桌面控制栏", WS_POPUP, 0, 0, 440, 40, owner, nullptr, definition.hInstance, chrome);
    if (!chrome->bar) { delete chrome; return; }
    const char* title = SDL_GetWindowTitle(window);
    if (!title) title = "";
    int length = MultiByteToWideChar(CP_UTF8, 0, title, -1, nullptr, 0);
    std::wstring caption(std::max(1, length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, title, -1, caption.data(), length);
    chrome->title = CreateWindowExW(0, L"STATIC", caption.c_str(), WS_CHILD | WS_VISIBLE | SS_ENDELLIPSIS,
        0, 0, 0, 0, chrome->bar, nullptr, definition.hInstance, nullptr);
    // Disabled static labels pass pointer messages through to the bar.
    EnableWindow(chrome->title, FALSE);
    INITCOMMONCONTROLSEX controls{sizeof(controls), ICC_WIN95_CLASSES}; InitCommonControlsEx(&controls);
    chrome->tooltip = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, nullptr,
        WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT,
        chrome->bar, nullptr, definition.hInstance, nullptr);
    const wchar_t* labels[] = {L"最小化", L"最大化", L"全屏", L"关闭"};
    for (int i = 0; i < 4; i++) {
        chrome->buttons[i] = CreateWindowExW(0, L"BUTTON", labels[i], WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW,
            0, 0, 0, 0, chrome->bar, reinterpret_cast<HMENU>(static_cast<INT_PTR>(i + 1)), definition.hInstance, nullptr);
        auto previous = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(chrome->buttons[i], GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(buttonProcedure)));
        if (!chrome->buttonProcedure) chrome->buttonProcedure = previous;
        TOOLINFOW tool = {}; tool.cbSize = sizeof(tool); tool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
        tool.hwnd = chrome->bar; tool.uId = reinterpret_cast<UINT_PTR>(chrome->buttons[i]);
        tool.lpszText = const_cast<wchar_t*>(labels[i]);
        SendMessageW(chrome->tooltip, TTM_ADDTOOLW, 0, reinterpret_cast<LPARAM>(&tool));
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
    DestroyWindow(chrome->tooltip);
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

extern "C" void dssh_chrome_hide_all(void)
{
    for (auto chrome : bars) {
        chrome->reveal.visible = false;
        chrome->dragging = false;
        if (GetCapture() == chrome->bar) ReleaseCapture();
        chrome->hovered = -1;
        ShowWindow(chrome->tooltip, SW_HIDE);
        ShowWindow(chrome->bar, SW_HIDE);
        if (chrome->taskbar && chrome->markedFullscreen) {
            chrome->taskbar->MarkFullscreenWindow(chrome->owner, FALSE);
            chrome->markedFullscreen = false;
        }
    }
}

extern "C" bool dssh_chrome_set_locked(bool locked)
{
    if (locked) dssh_chrome_hide_all();
    for (auto chrome : bars)
        if (locked && IsWindowVisible(chrome->bar)) return false;
    return true;
}

#ifdef DSSH_CHROME_TESTING
extern "C" bool dssh_chrome_test_drag(SDL_Window* window)
{
    auto chrome = static_cast<Chrome*>(SDL_GetPointerProperty(SDL_GetWindowProperties(window), propertyName, nullptr));
    if (!chrome) return false;
    RECT client = {};
    GetClientRect(chrome->owner, &client);
    const auto frame = dssh_chrome_frame(chrome->position, float(client.right), float(client.bottom), 440, 40);
    POINT origin = {int(frame.x), int(frame.y)};
    ClientToScreen(chrome->owner, &origin);
    SetWindowPos(chrome->bar, nullptr, origin.x, origin.y, int(frame.w), int(frame.h), SWP_NOZORDER | SWP_NOACTIVATE);
    const auto before = chrome->position;
    SendMessageW(chrome->bar, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(10, 10));
    SendMessageW(chrome->bar, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(70, 50));
    SendMessageW(chrome->bar, WM_LBUTTONUP, 0, MAKELPARAM(70, 50));
    return !chrome->dragging && GetCapture() != chrome->bar &&
        chrome->position.x > before.x && chrome->position.y > before.y;
}
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
    // BM_CLICK simulates mouse down/up. The production bar starts hidden and
    // its children have zero-sized client areas until the first edge reveal.
    // Arrange actual controls before clicking; CI must not depend on pointer
    // position or foreground activation to prepare the fixture.
    if (!chrome->buttons[index] || !IsWindow(chrome->buttons[index])) return false;
    layoutControls(chrome, 440, 40, 1.0f);
    if (!SetWindowPos(chrome->bar, nullptr, 0, 0, 440, 40,
                      SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW)) return false;
    SendMessageW(chrome->buttons[index], BM_CLICK, 0, 0);
    return true;
}
#endif
