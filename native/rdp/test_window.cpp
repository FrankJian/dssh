#include "dssh_window.hpp"
#if defined(_WIN32)
#include <windows.h>
#endif

int main()
{
    auto settings = freerdp_settings_new(0);
    if (!settings) return 13;
    freerdp_settings_set_bool(settings, FreeRDP_Fullscreen, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_UseMultimon, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_ForceMultimon, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_SpanMonitors, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_Decorations, FALSE);
    freerdp_settings_set_bool(settings, FreeRDP_SmartSizing, FALSE);
    const bool policy = dssh_apply_window_policy(settings) &&
        !freerdp_settings_get_bool(settings, FreeRDP_Fullscreen) &&
        !freerdp_settings_get_bool(settings, FreeRDP_UseMultimon) &&
        !freerdp_settings_get_bool(settings, FreeRDP_ForceMultimon) &&
        !freerdp_settings_get_bool(settings, FreeRDP_SpanMonitors) &&
        freerdp_settings_get_bool(settings, FreeRDP_Decorations) &&
        freerdp_settings_get_bool(settings, FreeRDP_SmartSizing);
    freerdp_settings_free(settings);
    if (!policy) return 14;
    // Oversized desktop on a secondary monitor, with a taskbar / title bar.
    const SDL_Rect usable{-1920, 40, 1920, 1000};
    const auto rect = dssh_window_geometry(3840, 2160, usable, 32, 8, 8, 8);
    if (rect.x - 8 < usable.x || rect.y - 32 < usable.y ||
        rect.x + rect.w + 8 > usable.x + usable.w ||
        rect.y + rect.h + 8 > usable.y + usable.h) return 1;
    if (std::abs(double(rect.w) / rect.h - 3840.0 / 2160.0) > 0.01) return 2;
    const auto compactWindow = dssh_window_geometry(640, 480, usable, 32, 8, 8, 8);
    if (compactWindow.w != 640 || compactWindow.h != 480) return 3;
#if defined(__APPLE__)
    // Keep this short-lived CI fixture off macOS Spaces; exercise SDL desktop
    // fullscreen without an asynchronous system Space animation.
    SDL_SetHint(SDL_HINT_VIDEO_MAC_FULLSCREEN_SPACES, "0");
#endif
    if (!SDL_Init(SDL_INIT_VIDEO)) return 4;
    auto window = SDL_CreateWindow("Duo SSH window regression", 3840, 2160, SDL_WINDOW_RESIZABLE);
    if (!window) { SDL_Quit(); return 5; }
    const auto display = SDL_GetDisplayForWindow(window);
    // Exercise a real fullscreen -> decorated-window transition, not only a
    // newly created window that was already windowed.
    SDL_SetWindowFullscreen(window, true);
    SDL_SyncWindow(window);
    if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN)) return 15;
    dssh_prepare_desktop_window(window, display);
    const auto flags = SDL_GetWindowFlags(window);
    int width = 0, height = 0;
    SDL_GetWindowSize(window, &width, &height);
    SDL_Rect work = {};
    SDL_GetDisplayUsableBounds(display, &work);
    int result = 0;
    if (!(flags & SDL_WINDOW_RESIZABLE) || (flags & (SDL_WINDOW_BORDERLESS | SDL_WINDOW_FULLSCREEN))) result = 6;
    if (width >= work.w || height >= work.h) result = 7;
    int x = 0, y = 0, top = 0, left = 0, bottom = 0, right = 0;
    SDL_GetWindowPosition(window, &x, &y);
    if (SDL_GetWindowBordersSize(window, &top, &left, &bottom, &right) &&
        (x - left < work.x || y - top < work.y ||
         x + width + right > work.x + work.w || y + height + bottom > work.y + work.h)) result = 10;
    if (!SDL_SetWindowSize(window, width / 2, height / 2)) result = 8;
    SDL_SyncWindow(window);
    int resizedWidth = 0, resizedHeight = 0;
    SDL_GetWindowSize(window, &resizedWidth, &resizedHeight);
    if (resizedWidth != width / 2 || resizedHeight != height / 2) result = 9;
    SDL_SetWindowPosition(window, work.x + 48, work.y + 96);
    SDL_SyncWindow(window);
    int movedX = 0, movedY = 0;
    SDL_GetWindowPosition(window, &movedX, &movedY);
    if (movedX != work.x + 48 || movedY != work.y + 96) result = 11;
#if defined(_WIN32)
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(SDL_GetWindowProperties(window),
                                                        SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    const LONG_PTR controls = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    if (!hwnd || (GetWindowLongPtrW(hwnd, GWL_STYLE) & controls) != controls) result = 12;
#endif
    SDL_DestroyWindow(window);
    SDL_Quit();
    return result;
}
