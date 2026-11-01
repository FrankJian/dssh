#include "dssh_icon.hpp"
#if defined(_WIN32)
#include <windows.h>

void dssh_set_application_icon() {}

void dssh_set_window_icon(SDL_Window* window)
{
    if (!window) return;
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(
        SDL_GetWindowProperties(window), SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    if (!hwnd) return;
    const auto module = GetModuleHandleW(nullptr);
    // The same multi-resolution resource is used by Explorer and native chrome.
    const auto big = LoadImageW(module, MAKEINTRESOURCEW(101), IMAGE_ICON,
                               GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_SHARED);
    const auto small = LoadImageW(module, MAKEINTRESOURCEW(101), IMAGE_ICON,
                                 GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_SHARED);
    if (big) SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(big));
    if (small) SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(small));
}
#else
// macOS uses NSApplication's Dock / app-switcher icon instead of a window icon.
void dssh_set_window_icon(SDL_Window*) {}
#endif
