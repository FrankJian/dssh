#include "dssh_window.hpp"
#include "dssh_chrome.h"
#include <cstring>
#include <cstdlib>
#if defined(_WIN32)
#include <windows.h>
#endif

int main(int argc, char** argv)
{
    const bool previewMode = (argc == 2 && std::strcmp(argv[1], "--preview") == 0) || std::getenv("DSSH_RDP_CHROME_PREVIEW");
    DsshChromeReveal reveal = {};
    if (dssh_chrome_reveal(&reveal, false, true, false, 0)) return 16;
    if (!dssh_chrome_reveal(&reveal, true, true, false, 10)) return 17;
    if (!dssh_chrome_reveal(&reveal, true, false, true, 20)) return 18;
    if (!dssh_chrome_reveal(&reveal, true, false, false, 669)) return 19;
    if (dssh_chrome_reveal(&reveal, true, false, false, 670)) return 20;
    if (!dssh_chrome_reveal(&reveal, true, true, false, 680)) return 21;
    if (dssh_chrome_reveal(&reveal, false, false, true, 690)) return 22;
    SDL_Event closeEvent = {};
    closeEvent.type = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
    if (!dssh_is_system_close(closeEvent, true)) return 25;
    if (dssh_is_system_close(closeEvent, false)) return 26;
    closeEvent.type = SDL_EVENT_QUIT;
    if (!dssh_is_system_close(closeEvent, false)) return 27;
    closeEvent.type = SDL_EVENT_WINDOW_MINIMIZED;
    if (dssh_is_system_close(closeEvent, true)) return 28;
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
    if (!previewMode) {
        SDL_SetWindowFullscreen(window, true);
        SDL_SyncWindow(window);
        if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN)) return 15;
    }
    dssh_prepare_desktop_window(window, display);
    dssh_chrome_attach(window);
    if (previewMode) {
        SDL_RaiseWindow(window);
        SDL_SyncWindow(window);
        bool running = true;
        while (running) {
            dssh_chrome_tick();
            SDL_SetWindowTitle(window, dssh_chrome_test_visible(window) ? "Preview - toolbar visible" : "Preview - toolbar hidden");
            SDL_Event event = {};
            if (!SDL_WaitEventTimeout(&event, 60)) continue;
            if (event.type == SDL_EVENT_QUIT || event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED) running = false;
            if (event.type != SDL_EVENT_USER) continue;
            switch (event.user.code) {
                case DSSH_CHROME_MINIMIZE: SDL_MinimizeWindow(window); break;
                case DSSH_CHROME_MAXIMIZE:
                    if (SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN) dssh_prepare_desktop_window(window, display);
                    else if (SDL_GetWindowFlags(window) & SDL_WINDOW_MAXIMIZED) SDL_RestoreWindow(window);
                    else SDL_MaximizeWindow(window);
                    break;
                case DSSH_CHROME_FULLSCREEN:
                    if (SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN) dssh_prepare_desktop_window(window, display);
                    else SDL_SetWindowFullscreen(window, true);
                    break;
                case DSSH_CHROME_CLOSE: running = false; break;
            }
        }
        dssh_chrome_detach(window);
        SDL_DestroyWindow(window); SDL_Quit(); return 0;
    }
    for (int action = DSSH_CHROME_MINIMIZE; action <= DSSH_CHROME_CLOSE; action++) {
        if (!dssh_chrome_test_click(window, action)) return 23;
        SDL_Event event = {};
        bool received = false;
        while (SDL_PollEvent(&event))
            if (event.type == SDL_EVENT_USER && event.user.code == action && event.user.windowID == SDL_GetWindowID(window)) received = true;
        if (!received) return 24;
    }
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
    dssh_chrome_detach(window);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return result;
}
