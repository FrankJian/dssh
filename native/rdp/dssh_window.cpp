#include "dssh_window.hpp"

void dssh_prepare_desktop_window(SDL_Window* window, SDL_DisplayID display)
{
    if (!window) return;
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
