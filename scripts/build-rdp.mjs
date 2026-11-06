// Builds a pinned native worker. No build tools are needed on end-user machines.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync, rmSync, renameSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { extractArchive } from "./rdp-archive.mjs";
import { WINDOWS_TRIPLET, windowsCmakeArguments, validateWindowsRuntime } from "./rdp-windows.mjs";
import { chromeThemeHeader } from "./rdp-chrome-theme.mjs";
import { adaptClipboard } from "./rdp-clipboard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "3.33.0";
const windows = process.platform === "win32";
const checksum = "3b5e7733e667ad66f54e0db51d952268c9d08b2e71a4fade44c716ab29dd5657";
const cache = join(root, ".cache", "rdp");
const archive = process.env.DSSH_RDP_ARCHIVE || join(cache, `FreeRDP-${version}.tar.gz`);
const source = join(cache, `FreeRDP-${version}`);
// Isolate the corrected static CRT build from caches made with static-md.
const build = join(cache, `build-${version}-${windows ? "windows-static" : "macos"}`);
const dependencies = join(cache, "dependencies");
const installedRuntime = join(root, "src-tauri", "rdp-runtime");
const runtime = join(cache, "runtime-stage");
const nativePrefix = process.env.DSSH_RDP_PREFIX || (existsSync("/opt/homebrew") ? "/opt/homebrew" : "/usr/local");
if (!windows && process.platform !== "darwin") throw new Error("The RDP worker currently targets Windows and macOS.");
mkdirSync(cache, { recursive: true });
rmSync(runtime, { recursive: true, force: true }); mkdirSync(runtime, { recursive: true });
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
if (!existsSync(archive)) run("curl", ["-L", "--fail", "--retry", "3", `https://github.com/FreeRDP/FreeRDP/archive/refs/tags/${version}.tar.gz`, "-o", archive]);
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== checksum) throw new Error("FreeRDP archive checksum mismatch");
// Extract afresh so adaptation anchors are checked on every build.
extractArchive(archive, cache);
const sdl = join(source, "client", "SDL", "SDL3");
copyFileSync(join(root, "native", "rdp", "dssh_worker.hpp"), join(sdl, "dssh_worker.hpp"));
copyFileSync(join(root, "native/rdp/test_preferences.cpp"), join(sdl, "dssh_test_preferences.cpp"));
for (const file of ["dssh_window.hpp", "dssh_window.cpp", "dssh_activity.h", "dssh_activity.cpp", "test_window.cpp", "dssh_chrome.h", "dssh_chrome_visual.h", "dssh_chrome_win.cpp", "dssh_chrome_mac.m", "dssh_clipboard.h", "test_clipboard.cpp", "dssh_keyboard.hpp", "test_keyboard.cpp", "dssh_visibility.h", "dssh_visibility.cpp", "dssh_visibility_state.h"]) {
  copyFileSync(join(root, "native/rdp", file), join(sdl, file));
}
writeFileSync(join(sdl, "dssh_chrome_palette.h"), chromeThemeHeader(readFileSync(join(root, "src/theme/global.css"), "utf8")));
for (const file of ["dssh_icon.hpp", "dssh_icon.cpp", "dssh_icon.m", "dssh_icon.rc"]) {
  copyFileSync(join(root, "native", "rdp", file), join(sdl, file));
}
copyFileSync(join(root, "native/rdp/icons/rdp.ico"), join(sdl, "dssh-rdp.ico"));
// Embed the macOS Dock image: the worker is a standalone executable, not an .app.
// No image path or external decoder is needed on the user's machine.
const iconPng = readFileSync(join(root, "native/rdp/icons/rdp.png"));
writeFileSync(join(sdl, "dssh_icon_data.hpp"), `#pragma once\nstatic const unsigned char dssh_icon_png[] = {\n${Array.from(iconPng, (byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(",")}\n};\n`);
function adapt(file, anchor, replacement, expectedCount = 1) {
  const contents = readFileSync(file, "utf8");
  if (contents.split(anchor).length !== expectedCount + 1) throw new Error(`Pinned FreeRDP adaptation anchor changed: ${basename(file)}`);
  writeFileSync(file, contents.replaceAll(anchor, replacement));
}
const main = join(sdl, "sdl_freerdp.cpp");
adaptClipboard(source, sdl, adapt);
adapt(main, '#include "sdl_utils.hpp"', '#include "sdl_utils.hpp"\n#include "dssh_worker.hpp"\n#include "dssh_icon.hpp"\n#include "dssh_window.hpp"\n#include "dssh_chrome.h"');
adapt(main, "\t/* Redirect SDL log messages to wLog */", "\tdssh_set_application_icon();\n\t/* Redirect SDL log messages to wLog */");
const window = join(sdl, "sdl_window.cpp");
adapt(window, '#include "sdl_window.hpp"', '#include "sdl_window.hpp"\n#include "dssh_icon.hpp"\n#include "dssh_window.hpp"\n#include "dssh_chrome.h"');
adapt(window, "\tstd::ignore = resizeToScale();", "\tstd::ignore = resizeToScale();\n\tdssh_prepare_desktop_window(_window, id);\n\tdssh_chrome_attach(_window);");
adapt(window, "SdlWindow::~SdlWindow()\n{", "SdlWindow::~SdlWindow()\n{\n\tdssh_chrome_detach(_window);\n\tdssh_restore_desktop_input(_window);");
// Post-connect and fullscreen-exit events run after initial window creation.
adapt(window, "\tstd::ignore = SDL_SetWindowFullscreen(_window, enter);\n\tstd::ignore = SDL_SyncWindow(_window);",
  "\tstd::ignore = SDL_SetWindowFullscreen(_window, enter);\n\tstd::ignore = SDL_SyncWindow(_window);\n\tif (!enter) dssh_prepare_desktop_window(_window, _displayID);");
// Initial window and fallback/recreated window must both retain the icon.
adapt(window, "\t_window = SDL_CreateWindowWithProperties(props);", "\tif (dssh_desktop_locked()) SDL_SetBooleanProperty(props, SDL_PROP_WINDOW_CREATE_HIDDEN_BOOLEAN, true);\n\t_window = SDL_CreateWindowWithProperties(props);\n\tdssh_visibility_created(_window);\n\tdssh_set_window_icon(_window);", 2);
adapt(window, '#include "dssh_chrome.h"', '#include "dssh_chrome.h"\n#include "dssh_visibility.h"');
const clientCmake = join(sdl, "CMakeLists.txt");
// Enable at the common root so sibling macOS targets share Objective-C rules.
adapt(join(source, "CMakeLists.txt"), "project(FreeRDP LANGUAGES C)", "project(FreeRDP LANGUAGES C)\nif(APPLE)\n  enable_language(OBJC)\nendif()");
adapt(clientCmake, "target_link_libraries(${MODULE_NAME} PRIVATE ${LIBS})", `target_sources(\${MODULE_NAME} PRIVATE dssh_icon.cpp dssh_window.cpp dssh_visibility.cpp dssh_activity.cpp)
if(APPLE)
  target_sources(\${MODULE_NAME} PRIVATE dssh_icon.m dssh_chrome_mac.m)
  set_source_files_properties(dssh_icon.m dssh_chrome_mac.m PROPERTIES COMPILE_FLAGS "-fobjc-arc")
  target_link_libraries(\${MODULE_NAME} PRIVATE "-framework AppKit")
elseif(WIN32)
  target_sources(\${MODULE_NAME} PRIVATE dssh_icon.rc dssh_chrome_win.cpp dssh_clipboard_win.c)
  target_link_libraries(\${MODULE_NAME} PRIVATE comctl32)
  target_include_directories(\${MODULE_NAME} PRIVATE \${CMAKE_CURRENT_SOURCE_DIR})
  target_link_libraries(\${MODULE_NAME} PRIVATE user32 gdi32 ole32 shell32 imm32 dwmapi uuid)
endif()
target_link_libraries(\${MODULE_NAME} PRIVATE \${LIBS})`);
// Optional SDL preferences must not prevent a managed connection from starting.
// ProgramData is a common folder: querying it as Default User (-1) can fail when
// that profile's hive is unavailable. Use the current token (NULL) instead.
adapt(join(source, "winpr/libwinpr/path/shell.c"),
  "win_get_known_folder(&FOLDERID_ProgramData, FALSE)",
  "win_get_known_folder(&FOLDERID_ProgramData, TRUE)");
const preferences = join(source, "client/SDL/common/sdl_prefs.cpp");
adapt(preferences, "\tfs::path config{ name.get() };\n\treturn config.string();",
  '\t// Keep the UTF-8 path returned by WinPR; an unavailable optional path is empty.\n\treturn name ? std::string(name.get()) : std::string{};');
adapt(preferences, "\tauto config = get_pref_file(systemConfigOnly);",
  '\tauto config = get_pref_file(systemConfigOnly);\n\tif (config.empty()) return { nullptr, WINPR_JSON_Delete };');
writeFileSync(clientCmake, readFileSync(clientCmake, "utf8") + `
# Compile the real preferences code with a resolver that simulates missing paths.
add_executable(dssh-rdp-clipboard-test test_clipboard.cpp)
target_link_libraries(dssh-rdp-clipboard-test PRIVATE freerdp SDL3::SDL3${windows ? "-static" : ""})
add_executable(dssh-rdp-keyboard-test test_keyboard.cpp)
target_link_libraries(dssh-rdp-keyboard-test PRIVATE freerdp SDL3::SDL3${windows ? "-static" : ""})
add_executable(dssh-rdp-prefs-test dssh_test_preferences.cpp ../common/sdl_prefs.cpp)
target_include_directories(dssh-rdp-prefs-test PRIVATE ../common)
target_compile_definitions(dssh-rdp-prefs-test PRIVATE freerdp_GetConfigFilePath=dssh_test_config_path)
target_link_libraries(dssh-rdp-prefs-test PRIVATE freerdp freerdp-cxx-filesystem)
add_executable(dssh-rdp-window-test test_window.cpp dssh_window.cpp dssh_visibility.cpp dssh_activity.cpp)
target_compile_definitions(dssh-rdp-window-test PRIVATE DSSH_CHROME_TESTING)
target_link_libraries(dssh-rdp-window-test PRIVATE freerdp SDL3::SDL3${windows ? "-static" : ""})
if(APPLE)
  target_sources(dssh-rdp-window-test PRIVATE dssh_chrome_mac.m)
  target_link_libraries(dssh-rdp-window-test PRIVATE "-framework AppKit")
elseif(WIN32)
  target_sources(dssh-rdp-window-test PRIVATE dssh_chrome_win.cpp)
  target_link_libraries(dssh-rdp-window-test PRIVATE user32 gdi32 ole32 imm32 dwmapi uuid comctl32)
endif()
`);
adapt(main, "int main(int argc, char* argv[])\n{", `int main(int argc, char* argv[])\n{\n    if (argc == 2 && std::strcmp(argv[1], "--dssh-crypto-self-test") == 0) return dssh_crypto_self_test();\n    std::vector<std::string> privateArgs;\n    std::vector<char*> privatePointers;\n    if (!dssh_arguments(argc, argv, privateArgs, privatePointers)) return 120;\n    std::ignore = WLog_SetLogLevel(WLog_GetRoot(), WLOG_OFF);\n    if (const int code = dssh_crypto_self_test(false)) return code;\n    dssh_status("stage context");`);
// Keep Windows inherited private pipes; never detach their console handles.
adapt(main, "\tsdl::win32::release_transient_console();", "\t// Duo SSH owns the inherited pipes.");
adapt(main, "[[nodiscard]] static BOOL sdl_client_global_init()\n{", '[[nodiscard]] static BOOL sdl_client_global_init()\n{\n\tdssh_status("stage platform");');
adapt(main, "\tsdl->sdl = new SdlContext(context);", '\tdssh_status("stage sdl-context");\n\tsdl->sdl = new SdlContext(context);');
// Assertions remain fatal. Report only a hash of the compile-time source basename
// and its line number; never expose conditions, paths, stack memory or raw logs.
const assertion = join(source, "winpr/libwinpr/crt/assert.c");
adapt(assertion, "\twLog* _log_cached_ptr = WLog_Get(\"com.freerdp.winpr.assert\");", `\tconst char* base = file;
\tfor (const char* p = file; *p; p++) if (*p == '/' || *p == '\\\\') base = p + 1;
\tuint32_t site = 2166136261u;
\tfor (const unsigned char* p = (const unsigned char*)base; *p; p++) site = (site ^ *p) * 16777619u;
\tprintf("DSSH_RDP_V1 fault %u %zu\\n", (unsigned)site, line);
\tfflush(stdout);
\twLog* _log_cached_ptr = WLog_Get("com.freerdp.winpr.assert");`);
adapt(main, "\tsdl_rdp->sdl->setMetadata();", "\tdssh_wipe_arguments(privateArgs);\n\tif (status == 0 && !dssh_apply_window_policy(settings)) return -1;\n\tsdl_rdp->sdl->setMetadata();");
adapt(main, "\tauto status = freerdp_client_settings_parse_command_line_ex(", '\tdssh_status("stage arguments");\n\tauto status = freerdp_client_settings_parse_command_line_ex(');
adapt(main, "\t/* Basic SDL initialization */", '\tdssh_status("stage display");\n\t/* Basic SDL initialization */');
adapt(main, "\tif (freerdp_client_start(context) != 0)", '\tdssh_status("stage connect");\n\tif (freerdp_client_start(context) != 0)');
adapt(main, "\t\twhile (!sdl->shallAbort())\n\t\t{", "\t\twhile (!sdl->shallAbort())\n\t\t{\n\t\t\tdssh_visibility_tick();\n\t\t\tdssh_chrome_tick();");
adapt(main, "\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))", `#if !defined(_WIN32)
                if (windowEvent.type == SDL_EVENT_WINDOW_FOCUS_GAINED) {
                    size_t count = 0;
                    auto mimes = SDL_GetClipboardMimeTypes(&count);
                    SDL_ClipboardEvent clipboardEvent = {};
                    clipboardEvent.type = SDL_EVENT_CLIPBOARD_UPDATE;
                    clipboardEvent.timestamp = SDL_GetTicksNS();
                    clipboardEvent.num_mime_types = static_cast<Sint32>(count);
                    clipboardEvent.mime_types = const_cast<const char**>(mimes);
                    std::ignore = sdl->getClipboardChannelContext().handleEvent(clipboardEvent);
                    SDL_free(mimes);
                }
#endif
\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))`);
adapt(main, "SDL_WaitEventTimeout(nullptr, 1000)", "SDL_WaitEventTimeout(nullptr, 50)");
adapt(main, "\t\t\t\t/* Only poll standard SDL events", "\t\t\t\tdssh_visibility_tick();\n\t\t\t\tdssh_chrome_tick();\n\t\t\t\t/* Only poll standard SDL events");
adapt(main, "\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))", `                dssh_visibility_tick();
                if (dssh_visibility_blocks(&windowEvent)) continue;
                dssh_record_input_activity(&windowEvent);
\t\t\t\t// Capture native close/quit before dialog and display handlers can consume
                // the event or fail while the desktop is being torn down.
                const bool desktopClose = windowEvent.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED &&
                    sdl->getWindowForId(windowEvent.window.windowID) != nullptr;
                if (dssh_is_system_close(windowEvent, desktopClose)) {
                    dssh_status("user-close");
                    std::ignore = freerdp_abort_connect_context(sdl->context());
                    continue;
                }
                if (windowEvent.type == SDL_EVENT_WINDOW_FOCUS_GAINED &&
                    sdl->getWindowForId(windowEvent.window.windowID))
                    dssh_prepare_desktop_input(SDL_GetWindowFromID(windowEvent.window.windowID));
                if (windowEvent.type == SDL_EVENT_USER) {
                    if (dssh_desktop_locked() && windowEvent.user.code != DSSH_DESKTOP_VISIBILITY) continue;
                    auto desktop = windowEvent.user.windowID ? SDL_GetWindowFromID(windowEvent.user.windowID) : nullptr;
                    switch (windowEvent.user.code) {
                        case DSSH_DESKTOP_VISIBILITY: dssh_visibility_tick(); break;
                        case DSSH_CHROME_MINIMIZE:
                            if (desktop && !SDL_MinimizeWindow(desktop)) {
                                std::ignore = sdl->setFullscreen(false);
                                std::ignore = sdl->setMinimized();
                            }
                            break;
                        case DSSH_CHROME_MAXIMIZE:
                            if (sdl->fullscreen()) std::ignore = sdl->setFullscreen(false);
                            else if (desktop && (SDL_GetWindowFlags(desktop) & SDL_WINDOW_MAXIMIZED)) SDL_RestoreWindow(desktop);
                            else if (desktop) SDL_MaximizeWindow(desktop);
                            break;
                        case DSSH_CHROME_FULLSCREEN: std::ignore = sdl->toggleFullscreen(); break;
                        case DSSH_CHROME_CLOSE:
                            dssh_status("user-close");
                            std::ignore = freerdp_abort_connect_context(sdl->context());
                            break;
                        default: dssh_focus_windows(); break;
                    }
                    continue;
                }
\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))`);
const context = join(sdl, "sdl_context.cpp");
adapt(context, "\tif (!sdl->setResizeable(false))", "\tif (!sdl->setResizeable(true))");
adapt(context, '#include "sdl_context.hpp"', '#include "sdl_context.hpp"\n#include "dssh_worker.hpp"');
adapt(context, '\t\t\tSDL_LogDebug(SDL_LOG_CATEGORY_APPLICATION, "Window closed, terminating RDP session...");', '\t\t\tdssh_status("user-close");\n\t\t\tSDL_LogDebug(SDL_LOG_CATEGORY_APPLICATION, "Window closed, terminating RDP session...");');
const input = join(sdl, "sdl_input.cpp");
adapt(input, '#include "sdl_input.hpp"', '#include "sdl_input.hpp"\n#include "dssh_worker.hpp"');
adapt(input, '#include "dssh_worker.hpp"', '#include "dssh_worker.hpp"\n#include "dssh_keyboard.hpp"');
adapt(join(sdl, "sdl_input.hpp"), '\tFREERDP_REMAP_TABLE* _remapTable = nullptr;', '\tFREERDP_REMAP_TABLE* _remapTable = nullptr;\n\tSDL_Keymod _dsshModifiers = SDL_KMOD_NONE;');
adapt(input, '\tauto scancode = freerdp_keyboard_remap_key(_remapTable, rdp_scancode);', `\tauto scancode = freerdp_keyboard_remap_key(_remapTable, rdp_scancode);
#ifdef _WIN32
    if (!dssh_reconcile_modifiers(_dsshModifiers, mods, scancode,
            ev.type == SDL_EVENT_KEY_DOWN, [this](bool down, UINT32 key) {
                return freerdp_input_send_keyboard_event_ex(_sdl->context()->input, down, FALSE, key) != FALSE;
            })) return false;
#endif`);
adapt(input, '\t/* finish with a mouse pointer position like mstsc.exe if required */', '\t_dsshModifiers = SDL_KMOD_NONE;\n\t/* finish with a mouse pointer position like mstsc.exe if required */');
adapt(join(sdl, "sdl_input.hpp"), '\t[[nodiscard]] bool keyboard_sync_state();', '\tvoid suspendForLock();\n\t[[nodiscard]] bool keyboard_sync_state();');
adapt(input, 'bool sdlInput::keyboard_sync_state()\n{', `void sdlInput::suspendForLock()
{
    _dsshModifiers = SDL_KMOD_NONE;
    for (const auto code : {RDP_SCANCODE_LCONTROL, RDP_SCANCODE_RCONTROL,
            RDP_SCANCODE_LSHIFT, RDP_SCANCODE_RSHIFT, RDP_SCANCODE_LMENU,
            RDP_SCANCODE_RMENU, RDP_SCANCODE_LWIN, RDP_SCANCODE_RWIN})
        std::ignore = freerdp_input_send_keyboard_event_ex(_sdl->context()->input, FALSE, FALSE, code);
    int count = 0;
    const auto pressed = SDL_GetKeyboardState(&count);
    for (int i = 0; pressed && i < count; i++) {
        if (!pressed[i]) continue;
        const auto code = scancode_to_rdp(static_cast<Uint32>(i));
        if (code != RDP_SCANCODE_UNKNOWN)
            std::ignore = freerdp_input_send_keyboard_event_ex(_sdl->context()->input, FALSE, FALSE,
                freerdp_keyboard_remap_key(_remapTable, code));
    }
}

bool sdlInput::keyboard_sync_state()
{`);
adapt(main, '#include "dssh_worker.hpp"', '#include "dssh_worker.hpp"\n#include "sdl_input.hpp"');
adapt(main, 'dssh_visibility_tick();', 'if (dssh_input_lock_entered() && sdl->isConnected()) sdl->getInputChannelContext().suspendForLock(); dssh_visibility_tick();', 4);
adapt(input, '\t\t\t\tfreerdp_abort_connect_context(_sdl->context());', '\t\t\t\tdssh_status("user-close");\n\t\t\t\tfreerdp_abort_connect_context(_sdl->context());');
adapt(context, "\tsdl->setConnected(true);", '\tsdl->setConnected(true);\n\tdssh_status("connected");');
// Credentials are already supplied. Never open a retry/credential dialog or retry a bad password.
adapt(context, "\tinstance->AuthenticateEx = sdl_authenticate_ex;", "\tinstance->AuthenticateEx = [](freerdp*, char**, char**, char**, rdp_auth_reason) -> BOOL { return FALSE; };");
adapt(context, "\tinstance->RetryDialog = sdl_retry_dialog;", "\tinstance->RetryDialog = [](freerdp*, const char*, size_t, void*) -> SSIZE_T { return -1; };");
adapt(context, "\t\t\t\tgetDialog().showError(error_msg);", "\t\t\t\t// Errors are presented by the trusted Duo SSH workbench.");
// Emit only numeric errors, never server-supplied text or raw library logs.
adapt(context, "\t\tUINT32 error = freerdp_get_last_error(context());", '\t\tUINT32 error = freerdp_get_last_error(context());\n\t\tstd::printf("DSSH_RDP_V1 error %u\\n", error); std::fflush(stdout);');
// Pins are exclusive: a different certificate must fail even if it has a valid CA.
const tls = join(source, "libfreerdp/crypto/tls.c");
adapt(tls, "\t/* Check, if we already accepted this key. */", `\tif (settings->CertificateAcceptedFingerprints)\n\t{\n\t\tverification_status = is_accepted_fingerprint(cert, settings->CertificateAcceptedFingerprints) ? 1 : 0;\n\t\tgoto end;\n\t}\n\t/* Check, if we already accepted this key. */`);
adapt(tls, "\t\tBOOL allowUserconfig = TRUE;", "\t\tif (settings->AutoDenyCertificate && (!certificate_status || !hostname_match)) goto end;\n\t\tBOOL allowUserconfig = TRUE;");
if (!windows) {
  const ttfArchive = process.env.DSSH_RDP_TTF_ARCHIVE || join(cache, "SDL_ttf-3.2.2.tar.gz");
  if (!existsSync(ttfArchive)) run("curl", ["-L", "--fail", "--retry", "3", "https://github.com/libsdl-org/SDL_ttf/archive/refs/tags/release-3.2.2.tar.gz", "-o", ttfArchive]);
  if (createHash("sha256").update(readFileSync(ttfArchive)).digest("hex") !== "ff6b81d3dc39d843cc3ead6dedd68043a79513d266792ea89445547ef4e9b073") throw new Error("SDL_ttf checksum mismatch");
  extractArchive(ttfArchive, cache);
  const prefix = nativePrefix;
  run("cmake", ["-S", join(cache, "SDL_ttf-release-3.2.2"), "-B", join(cache, "ttf-build"), "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
    `-DCMAKE_INSTALL_PREFIX=${dependencies}`, `-DCMAKE_PREFIX_PATH=${prefix}`, "-DSDLTTF_VENDORED=OFF", "-DSDLTTF_HARFBUZZ=OFF", "-DSDLTTF_PLUTOSVG=OFF", "-DSDLTTF_SAMPLES=OFF"]);
  run("cmake", ["--build", join(cache, "ttf-build"), "--parallel", "4"]);
  run("cmake", ["--install", join(cache, "ttf-build")]);
}
const args = ["-S", source, "-B", build, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
  "-DUSE_VERSION_FROM_GIT_TAG=OFF", `-DFREERDP_DEFAULT_PROJECT_VERSION=${version}`,
  "-DBUILD_SHARED_LIBS=OFF", "-DWITH_SERVER=OFF", "-DWITH_SAMPLE=OFF", "-DWITH_SHADOW=OFF",
  "-DWITH_CLIENT_SDL=ON", "-DWITH_CLIENT_SDL3=ON", "-DWITH_CLIENT_SDL2=OFF", "-DWITH_CLIENT_SDL_VERSIONED=ON",
  "-DWITH_X11=OFF", "-DWITH_WAYLAND=OFF", "-DWITH_MANPAGES=OFF", "-DWITH_FFMPEG=OFF", "-DWITH_SWSCALE=OFF",
  "-DWITH_CUPS=OFF", "-DWITH_PCSC=OFF", "-DWITH_PCSC_WINPR=OFF", "-DWITH_ALSA=OFF", "-DWITH_PULSE=OFF",
  "-DWITH_GSSAPI=OFF", "-DWITH_KRB5=OFF", "-DWITH_JPEG=OFF", "-DWITH_OPENH264=OFF",
  "-DWITH_OPUS=OFF", "-DWITH_WEBP=OFF", "-DWITH_URBDRC=OFF", "-DWITH_SMARTCARD_EMULATE=OFF",
  // NTLM/CredSSP must work on clean machines without OpenSSL's legacy module.
  "-DWITH_INTERNAL_MD4=ON", "-DWITH_INTERNAL_RC4=ON",
  "-DSDL_USE_COMPILED_RESOURCES=ON",
  "-DCHANNEL_URBDRC=OFF", "-DCHANNEL_SMARTCARD=OFF", "-DCHANNEL_DRIVE=OFF", "-DCHANNEL_PRINTER=OFF",
  "-DCHANNEL_SERIAL=OFF", "-DCHANNEL_PARALLEL=OFF", "-DCHANNEL_AUDIN=OFF", "-DCHANNEL_VIDEO=OFF",
  "-DWITH_WIN_CONSOLE=ON", "-DWITH_SDL_LINK_SHARED=ON", "-DOPENSSL_USE_STATIC_LIBS=ON",
  "-DBUILD_TESTING=OFF", "-DWITH_TESTING=OFF", "-DWITH_FREERDP_DEPRECATED=OFF"];
if (windows) {
  args.push(...windowsCmakeArguments(process.env.VCPKG_ROOT));
} else {
  const prefix = nativePrefix;
  args.push(`-DCMAKE_PREFIX_PATH=${dependencies};${prefix}/opt/sdl3;${prefix}/opt/openssl@4;${prefix}/opt/openssl@3`, "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0");
}
run("cmake", args);
if (windows) validateWindowsRuntime(readFileSync(join(build, "CMakeCache.txt"), "utf8"));
run("cmake", ["--build", build, "--target", "sdl3-freerdp", "dssh-rdp-prefs-test", "dssh-rdp-window-test", "dssh-rdp-clipboard-test", "dssh-rdp-keyboard-test", "--parallel", "4"]);
run(join(build, "client/SDL/SDL3", windows ? "dssh-rdp-keyboard-test.exe" : "dssh-rdp-keyboard-test"), []);
run(join(build, "client/SDL/SDL3", windows ? "dssh-rdp-clipboard-test.exe" : "dssh-rdp-clipboard-test"), []);
run(join(build, "client/SDL/SDL3", windows ? "dssh-rdp-prefs-test.exe" : "dssh-rdp-prefs-test"), []);
run(join(build, "client/SDL/SDL3", windows ? "dssh-rdp-window-test.exe" : "dssh-rdp-window-test"), []);
const output = join(build, "client/SDL/SDL3", windows ? "sdl3-freerdp.exe" : "sdl3-freerdp");
const binary = join(runtime, windows ? "dssh-rdp-client.exe" : "dssh-rdp-client");
copyFileSync(output, binary);
if (!windows) {
  // Copy and relocate every non-system dylib, including transitive dependencies.
  const seen = new Set();
  const prefixes = [dependencies, nativePrefix];
  function bundle(original, destination) {
    if (seen.has(destination)) return;
    seen.add(destination);
    run("chmod", ["u+w", destination]);
    const dependencies = execFileSync("otool", ["-L", original], { encoding: "utf8" }).split("\n").slice(1).map((line) => line.trim().split(" (", 1)[0]).filter(Boolean);
    for (const dependency of dependencies) {
      if (dependency.startsWith("/System/") || dependency.startsWith("/usr/lib/")) continue;
      let located = dependency;
      if (dependency.startsWith("@rpath/")) located = prefixes.map((p) => join(p, "lib", basename(dependency))).find(existsSync);
      if (!located || !existsSync(located)) throw new Error(`Cannot resolve native dependency: ${dependency}`);
      if (realpathSync(located) === realpathSync(original)) continue;
      const target = join(runtime, basename(dependency));
      if (!seen.has(target)) {
        copyFileSync(located, target); run("chmod", ["u+w", target]);
        run("install_name_tool", ["-id", `@loader_path/${basename(target)}`, target]); bundle(located, target);
      }
      run("install_name_tool", ["-change", dependency, `@loader_path/${basename(target)}`, destination]);
    }
    run("codesign", ["--force", "--sign", "-", destination]);
  }
  bundle(output, binary);
}
copyFileSync(join(source, "LICENSE"), join(runtime, "FreeRDP-LICENSE"));
for (const name of ["NOTICE", "LICENSE.txt"]) if (existsSync(join(source, name))) copyFileSync(join(source, name), join(runtime, `FreeRDP-${name}`));
copyFileSync(join(root, "native/rdp/THIRD-PARTY-NOTICES.md"), join(runtime, "THIRD-PARTY-NOTICES.md"));
// Include exact installed dependency licenses, not just links to their projects.
const licenseDir = join(runtime, "licenses"); mkdirSync(licenseDir, { recursive: true });
if (windows) {
  for (const dependency of ["sdl3", "sdl3-ttf", "openssl", "freetype", "brotli", "libpng", "json-c", "zlib"]) {
    const license = join(process.env.VCPKG_ROOT, "installed", WINDOWS_TRIPLET, "share", dependency, "copyright");
    if (existsSync(license)) copyFileSync(license, join(licenseDir, `${dependency}.txt`));
  }
} else {
  const prefix = nativePrefix;
  for (const [dependency, files] of Object.entries({ sdl3: ["LICENSE.txt"], "openssl@4": ["LICENSE.txt"], "openssl@3": ["LICENSE.txt"],
    freetype: ["LICENSE.TXT"], brotli: ["LICENSE"], libpng: ["LICENSE"], "json-c": ["COPYING"] })) {
    for (const file of files) {
      const license = join(prefix, "opt", dependency, file);
      if (existsSync(license)) copyFileSync(license, join(licenseDir, `${dependency}-${file}`));
    }
  }
  copyFileSync(join(cache, "SDL_ttf-release-3.2.2/LICENSE.txt"), join(licenseDir, "SDL_ttf-LICENSE.txt"));
}
writeFileSync(join(runtime, "engine.json"), JSON.stringify({ protocol: 1, freerdp: version, sourceSha256: checksum }, null, 2));
// Test the staged runtime without any build-host OpenSSL config/provider path.
// TLS-only smoke tests do not exercise NTLM's MD4 and RC4 requirements.
const cleanEnv = {};
for (const key of ["HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) {
  if (process.env[key] !== undefined) cleanEnv[key] = process.env[key];
}
cleanEnv.OPENSSL_MODULES = join(cache, "no-external-openssl-modules");
cleanEnv.OPENSSL_CONF = join(cache, "no-external-openssl-config.cnf");
const cryptoStatus = execFileSync(binary, ["--dssh-crypto-self-test"], { env: cleanEnv, encoding: "utf8", timeout: 10000, windowsHide: true });
if (cryptoStatus.trim() !== "DSSH_RDP_V1 crypto-ok") throw new Error("RDP native crypto portability self-test failed");
writeFileSync(join(runtime, ".gitkeep"), "");
// Replace only after every library and license was successfully prepared.
const previousRuntime = join(cache, "runtime-previous");
rmSync(previousRuntime, { recursive: true, force: true });
if (existsSync(installedRuntime)) renameSync(installedRuntime, previousRuntime);
try { renameSync(runtime, installedRuntime); }
catch (error) { if (existsSync(previousRuntime)) renameSync(previousRuntime, installedRuntime); throw error; }
rmSync(previousRuntime, { recursive: true, force: true });
console.log(`Built RDP worker: ${join(installedRuntime, basename(binary))}`);
