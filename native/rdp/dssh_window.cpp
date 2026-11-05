#include "dssh_window.hpp"
#include "dssh_visibility_state.h"
#ifdef _WIN32
#include <windows.h>
#include <imm.h>
#endif

void dssh_prepare_desktop_input(SDL_Window* window)
{
#ifdef _WIN32
    if (!window) return;
    // The desktop consumes physical scancodes, not local composition text.
    // This is per-window: never switch the user's system input method.
    SDL_StopTextInput(window);
    const auto props = SDL_GetWindowProperties(window);
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    if (!hwnd) return;
    const HIMC previous = ImmAssociateContext(hwnd, nullptr);
    if (!SDL_GetBooleanProperty(props, "dssh.input.detached", false)) {
        SDL_SetPointerProperty(props, "dssh.input.original-ime", previous);
        SDL_SetBooleanProperty(props, "dssh.input.detached", true);
    }
#else
    (void)window;
#endif
}

void dssh_restore_desktop_input(SDL_Window* window)
{
#ifdef _WIN32
    if (!window) return;
    const auto props = SDL_GetWindowProperties(window);
    if (!SDL_GetBooleanProperty(props, "dssh.input.detached", false)) return;
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    auto previous = static_cast<HIMC>(SDL_GetPointerProperty(props, "dssh.input.original-ime", nullptr));
    if (hwnd) ImmAssociateContext(hwnd, previous);
    SDL_ClearProperty(props, "dssh.input.original-ime");
    SDL_ClearProperty(props, "dssh.input.detached");
#else
    (void)window;
#endif
}

void dssh_prepare_desktop_window(SDL_Window* window, SDL_DisplayID display)
{
    if (!window) return;
    dssh_prepare_desktop_input(window);
    SDL_SetWindowFullscreen(window, false);
    SDL_SyncWindow(window);
    SDL_SetWindowBordered(window, true);
    SDL_SetWindowResizable(window, true);
    SDL_SyncWindow(window);
    SDL_Rect usable = {};
    int width = 0, height = 0;
    if (!SDL_GetDisplayUsableBounds(display, &usable) || usable.w <= 0 || usable.h <= 0 ||
        !SDL_GetWindowSize(window, &width, &height)) return;
    int top = 0, left = 0, bottom = 0, right = 0;
    if (!SDL_GetWindowBordersSize(window, &top, &left, &bottom, &right))
    {
        // A backend can defer reporting the frame until the first native paint.
        top = 48; left = bottom = right = 8;
    }
    const auto rect = dssh_window_geometry(width, height, usable, top, left, bottom, right);
    SDL_SetWindowSize(window, rect.w, rect.h);
    SDL_SetWindowPosition(window, rect.x, rect.y);
    SDL_SyncWindow(window);
}

// Called on SDL's UI thread after a user-initiated focus request. Restore only
// minimized windows: SDL_RestoreWindow on a maximized window would unmaximize it.
void dssh_focus_desktop_window(SDL_Window* window)
{
    if (!window || dssh_desktop_locked()) return;
#ifdef _WIN32
    const auto props = SDL_GetWindowProperties(window);
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    if (hwnd) {
        // Restore the native window synchronously before activation. SDL window
        // state events may still be queued when the pipe's focus event arrives.
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        else if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_SHOW);
        SDL_SyncWindow(window);
        SDL_RaiseWindow(window);
        // The parent grants this process foreground permission for this request.
        SetForegroundWindow(hwnd);
        return;
    }
#endif
    if (SDL_GetWindowFlags(window) & SDL_WINDOW_MINIMIZED) SDL_RestoreWindow(window);
    if (SDL_GetWindowFlags(window) & SDL_WINDOW_HIDDEN) SDL_ShowWindow(window);
    SDL_RaiseWindow(window);
    SDL_SyncWindow(window);
}
