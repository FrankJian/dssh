// Desktop composition for the pinned FreeRDP SDL3 client.
#include "sdl_window.hpp"
#include <cstdint>

bool SdlWindow::drawDesktopFrame(SDL_Surface* surface, const SDL_FPoint& scale,
                                 SDL_Point offset, const std::vector<SDL_Rect>& damage)
{
    if (!_renderer || !surface || !surface->pixels || surface->w <= 0 || surface->h <= 0)
        return false;
    const bool fresh = !_gdiTexture || _gdiTextureW != surface->w || _gdiTextureH != surface->h;
    if (!ensureGdiTexture(surface)) return false;
    ensureRenderTarget();
    if (!_renderTarget) return false;

    // Damage controls texture uploads only. A new texture must be initialized
    // from the complete decoded surface, even if the next update is tiny.
    if (fresh || damage.empty()) {
        if (!SDL_UpdateTexture(_gdiTexture, nullptr, surface->pixels, surface->pitch)) return false;
    } else {
        const auto* details = SDL_GetPixelFormatDetails(surface->format);
        if (!details || !details->bytes_per_pixel) return false;
        const SDL_Rect bounds{0, 0, surface->w, surface->h};
        for (const auto& dirty : damage) {
            SDL_Rect clipped = {};
            if (!SDL_GetRectIntersection(&bounds, &dirty, &clipped)) continue;
            const auto* pixels = static_cast<const uint8_t*>(surface->pixels) +
                static_cast<size_t>(clipped.y) * surface->pitch +
                static_cast<size_t>(clipped.x) * details->bytes_per_pixel;
            if (!SDL_UpdateTexture(_gdiTexture, &clipped, pixels, surface->pitch)) return false;
        }
    }

    // Compose once with one global transform. Scaling individual integer dirty
    // rectangles stretches their edge pixels differently and accumulates seams.
    // Rebuilding also fills a resized target from the retained desktop texture.
    if (!SDL_SetRenderTarget(_renderer, _renderTarget) ||
        !SDL_SetRenderDrawColor(_renderer, 0, 0, 0, 255) || !SDL_RenderClear(_renderer)) return false;
    const SDL_FRect destination{static_cast<float>(offset.x), static_cast<float>(offset.y),
        surface->w * scale.x, surface->h * scale.y};
    return SDL_RenderTexture(_renderer, _gdiTexture, nullptr, &destination);
}
