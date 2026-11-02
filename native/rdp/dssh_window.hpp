#pragma once
#include <SDL3/SDL.h>
#include <algorithm>
#include <cmath>

// SDL window sizes, border sizes and usable display bounds use logical units.
// Fit the outer frame, preserving the desktop's aspect ratio when shrinking.
inline SDL_Rect dssh_window_geometry(int width, int height, const SDL_Rect& usable,
                                     int top, int left, int bottom, int right)
{
    const int margin = std::min(16, std::min(usable.w, usable.h) / 20);
    const int availableW = std::max(1, usable.w - left - right - 2 * margin);
    const int availableH = std::max(1, usable.h - top - bottom - 2 * margin);
    const double scale = std::min({1.0, double(availableW) / std::max(1, width),
                                  double(availableH) / std::max(1, height)});
    const int w = std::max(1, int(std::floor(std::max(1, width) * scale)));
    const int h = std::max(1, int(std::floor(std::max(1, height) * scale)));
    // SDL positions describe the client area; keep its surrounding frame inside.
    return {usable.x + (usable.w - w - left - right) / 2 + left,
            usable.y + (usable.h - h - top - bottom) / 2 + top, w, h};
}

void dssh_prepare_desktop_window(SDL_Window* window, SDL_DisplayID display);
