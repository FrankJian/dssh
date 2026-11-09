// Pixel regressions using the real pinned SdlWindow and production compositor.
#include "sdl_window.hpp"
#include "dssh_chrome.h"
#include "dssh_visibility.h"
#include "dssh_icon.hpp"
#include <cstdio>
#include <cstring>
#include <memory>

// Isolate rendering from unrelated desktop chrome / input / monitor discovery.
// The upstream texture upload, render target, blit and present code is unchanged.
extern "C" void dssh_chrome_attach(SDL_Window*) {}
extern "C" void dssh_chrome_detach(SDL_Window*) {}
extern "C" bool dssh_desktop_locked() { return false; }
extern "C" void dssh_visibility_created(SDL_Window*) {}
void dssh_set_window_icon(SDL_Window*) {}
void dssh_prepare_desktop_window(SDL_Window*, SDL_DisplayID) {}
void dssh_restore_desktop_input(SDL_Window*) {}
namespace sdl::utils {
UINT32 orientaion_to_rdp(SDL_DisplayOrientation) { return ORIENTATION_LANDSCAPE; }
bool isWaylandDriver() { return false; }
bool isX11Driver() { return false; }
}

struct Window : SdlWindow {
    Window() : SdlWindow(SDL_GetPrimaryDisplay(), "RDP render regression", {0, 0, 320, 240}, SDL_WINDOW_HIDDEN) {}
};
using Surface = std::unique_ptr<SDL_Surface, decltype(&SDL_DestroySurface)>;
Surface snapshot(Window& window) { return Surface(SDL_RenderReadPixels(window.renderer(), nullptr), SDL_DestroySurface); }
bool same(SDL_Surface* a, SDL_Surface* b)
{
    if (!a || !b || a->w != b->w || a->h != b->h || a->format != b->format) return false;
    const auto* details = SDL_GetPixelFormatDetails(a->format);
    if (!details) return false;
    for (int y = 0; y < a->h; ++y)
        if (std::memcmp(static_cast<const Uint8*>(a->pixels) + y * a->pitch,
                        static_cast<const Uint8*>(b->pixels) + y * b->pitch,
                        a->w * details->bytes_per_pixel)) return false;
    return true;
}
void pattern(SDL_Surface* surface)
{
    for (int y = 0; y < surface->h; ++y) {
        const SDL_Rect line{0, y, surface->w, 1};
        SDL_FillSurfaceRect(surface, &line, SDL_MapSurfaceRGBA(surface,
            (y % 13 < 5) ? 240 : 24, (y % 13 < 5) ? 240 : 32, (y % 13 < 5) ? 240 : 48, 255));
    }
}

int main(int argc, char** argv)
{
    const bool upstream = argc == 2 && std::strcmp(argv[1], "--upstream") == 0;
    SDL_SetHint(SDL_HINT_RENDER_DRIVER, "software");
    if (!SDL_Init(SDL_INIT_VIDEO)) return 1;
    int result = 0;
    {
        Window updated, reference;
        auto source = Surface(SDL_CreateSurface(320, 240, SDL_PIXELFORMAT_BGRA32), SDL_DestroySurface);
        if (!source || !updated.renderer() || !reference.renderer()) return 2;
        pattern(source.get());
        // Odd dirty boundaries, both downscaling and upscaling; compare every
        // incremental frame with a fresh full paint of the same decoded image.
        for (const SDL_Point size : {SDL_Point{207, 157}, {481, 359}, {320, 240}}) {
            SDL_SetWindowSize(updated.window(), size.x, size.y);
            SDL_SetWindowSize(reference.window(), size.x, size.y);
            int w = 0, h = 0;
            SDL_GetWindowSizeInPixels(updated.window(), &w, &h);
            const SDL_FPoint scale{float(w) / source->w, float(h) / source->h};
            if (!updated.drawDesktopFrame(source.get(), scale, {0, 0}, {})) return 3;
            for (int i = 0; i < 24; ++i) {
                SDL_Rect dirty{7 + i, 5 + i * 7, 171, 3};
                SDL_FillSurfaceRect(source.get(), &dirty, SDL_MapSurfaceRGBA(source.get(), 20, 80 + i * 5, 180, 255));
                const bool painted = upstream ? updated.drawScaledRects(source.get(), scale, {dirty}) :
                    updated.drawDesktopFrame(source.get(), scale, {0, 0}, {dirty});
                if (!painted ||
                    !reference.drawDesktopFrame(source.get(), scale, {0, 0}, {})) return 4;
                auto actual = snapshot(updated), expected = snapshot(reference);
                if (!same(actual.get(), expected.get())) {
                    std::fprintf(stderr, "Incremental/full paint mismatch at %dx%d, update %d\n", w, h, i);
                    return 5;
                }
            }
            if (result) break;
        }
        // First paint is allowed to contain only a partial dirty rectangle.
        Window fresh;
        SDL_SetWindowSize(fresh.window(), 320, 240);
        if (!fresh.drawDesktopFrame(source.get(), {1, 1}, {0, 0}, {{1, 1, 3, 2}}) ||
            !reference.drawDesktopFrame(source.get(), {1, 1}, {0, 0}, {})) return 6;
        auto actual = snapshot(fresh), expected = snapshot(reference);
        if (!same(actual.get(), expected.get())) result = 7;
        // Recreated output target must contain retained pixels outside damage.
        SDL_SetWindowSize(fresh.window(), 401, 301);
        SDL_SetWindowSize(reference.window(), 401, 301);
        if (!fresh.drawDesktopFrame(source.get(), {1, 1}, {0, 0}, {{0, 0, 2, 1}}) ||
            !reference.drawDesktopFrame(source.get(), {1, 1}, {0, 0}, {})) return 8;
        actual = snapshot(fresh); expected = snapshot(reference);
        if (!same(actual.get(), expected.get())) result = 9;
    }
    SDL_Quit();
    if (result) std::fprintf(stderr, "RDP incremental/full paint pixel mismatch: %d\n", result);
    else std::puts("RDP dirty uploads / full composition pixel regressions passed");
    return result;
}
