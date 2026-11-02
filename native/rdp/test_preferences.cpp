// Fault injection against the actual adapted FreeRDP preferences implementation.
// Built and run on both native CI platforms; never included in the installer.
#include "sdl_prefs.hpp"
#include <freerdp/utils/helpers.h>
#include <cstdlib>
#include <cstring>

enum class PathMode { SystemMissing, AllMissing, Available };
static PathMode mode = PathMode::SystemMissing;
static const char fixturePath[] = "C:/dssh-missing-config/\xE9\x85\x8D\xE7\xBD\xAE/sdl-freerdp.json";

extern "C" char* dssh_test_config_path(BOOL system, const char*)
{
    if (mode == PathMode::AllMissing || (mode == PathMode::SystemMissing && system)) return nullptr;
    auto result = static_cast<char*>(std::malloc(sizeof(fixturePath)));
    if (result) std::memcpy(result, fixturePath, sizeof(fixturePath));
    return result;
}

int main()
{
    auto preferences = SdlPref::instance();
    if (!preferences) return 61;
    if (preferences->get_pref_file() != fixturePath) return 62;
    if (!preferences->get_pref_file(true).empty()) return 63;
    mode = PathMode::AllMissing;
    preferences = SdlPref::instance();
    if (!preferences || !preferences->get_pref_file().empty() ||
        !preferences->get_pref_file(true).empty()) return 1;
    if (preferences->get_string("SDL_Fullscreen", "default") != "default") return 2;
    if (!preferences->get_bool("SDL_Hotkeys", true)) return 3;
    mode = PathMode::Available;
    preferences = SdlPref::instance();
    if (preferences->get_pref_file() != fixturePath ||
        preferences->get_pref_file(true) != fixturePath) return 4;
    if (preferences->get_string("SDL_Fullscreen", "default") != "default") return 5;
    return 0;
}
