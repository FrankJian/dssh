// Builds a pinned native worker. No build tools are needed on end-user machines.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync, rmSync, renameSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { extractArchive } from "./rdp-archive.mjs";
import { WINDOWS_TRIPLET, windowsCmakeArguments, validateWindowsRuntime } from "./rdp-windows.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "3.32.2";
const windows = process.platform === "win32";
const checksum = "9ccb8357bf0188044a460de775c7ea289ca7d2a2a917eca0f0a7c4dc9c8b08ea";
const cache = join(root, ".cache", "rdp");
const archive = process.env.DSSH_RDP_ARCHIVE || join(cache, `FreeRDP-${version}.tar.gz`);
const source = join(cache, `FreeRDP-${version}`);
// Isolate the corrected static CRT build from caches made with static-md.
const build = join(cache, windows ? "build-windows-static" : "build");
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
function adapt(file, anchor, replacement) {
  const contents = readFileSync(file, "utf8");
  if (contents.split(anchor).length !== 2) throw new Error(`Pinned FreeRDP adaptation anchor changed: ${basename(file)}`);
  writeFileSync(file, contents.replace(anchor, replacement));
}
const main = join(sdl, "sdl_freerdp.cpp");
adapt(main, '#include "sdl_utils.hpp"', '#include "sdl_utils.hpp"\n#include "dssh_worker.hpp"');
adapt(main, "int main(int argc, char* argv[])\n{", `int main(int argc, char* argv[])\n{\n    std::vector<std::string> privateArgs;\n    std::vector<char*> privatePointers;\n    if (!dssh_arguments(argc, argv, privateArgs, privatePointers)) return 120;\n    std::ignore = WLog_SetLogLevel(WLog_GetRoot(), WLOG_OFF);`);
// Keep Windows inherited private pipes; never detach their console handles.
adapt(main, "\tsdl::win32::release_transient_console();", "\t// Duo SSH owns the inherited pipes.");
adapt(main, "\tsdl_rdp->sdl->setMetadata();", "\tdssh_wipe_arguments(privateArgs);\n\tsdl_rdp->sdl->setMetadata();");
adapt(main, "\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))", "\t\t\t\tif (windowEvent.type == SDL_EVENT_USER) { dssh_focus_windows(); continue; }\n\t\t\t\tif (sdl->getDialog().handleEvent(windowEvent))");
const context = join(sdl, "sdl_context.cpp");
adapt(context, '#include "sdl_context.hpp"', '#include "sdl_context.hpp"\n#include "dssh_worker.hpp"');
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
run("cmake", ["--build", build, "--target", "sdl3-freerdp", "--parallel", "4"]);
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
writeFileSync(join(runtime, ".gitkeep"), "");
// Replace only after every library and license was successfully prepared.
const previousRuntime = join(cache, "runtime-previous");
rmSync(previousRuntime, { recursive: true, force: true });
if (existsSync(installedRuntime)) renameSync(installedRuntime, previousRuntime);
try { renameSync(runtime, installedRuntime); }
catch (error) { if (existsSync(previousRuntime)) renameSync(previousRuntime, installedRuntime); throw error; }
rmSync(previousRuntime, { recursive: true, force: true });
console.log(`Built RDP worker: ${join(installedRuntime, basename(binary))}`);
