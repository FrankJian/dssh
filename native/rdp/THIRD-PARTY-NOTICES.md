# RDP worker third-party dependencies

The native worker adapts FreeRDP 3.32.2 (Apache-2.0); its LICENSE and available
NOTICE files are copied next to the worker. Modifications are in Duo SSH's
scripts/build-rdp.mjs and native/rdp/dssh_worker.hpp: private pipe startup,
bounded control/status messages, parent-death cleanup and disabled interactive
credential retries. Upstream: https://github.com/FreeRDP/FreeRDP/tree/3.32.2

SDL3 uses the zlib license: https://github.com/libsdl-org/SDL/blob/main/LICENSE.txt
OpenSSL 3/4 uses Apache-2.0: https://www.openssl.org/source/license.html

Release packagers must include the exact SDL and OpenSSL LICENSE / NOTICE files
from the dependency versions used to build the worker, verify the final linked
dependency list, and sign all native libraries and the worker with the release
identity. The local build script's ad-hoc signature is for development only.
Optional codecs, audio and device redirection are disabled in the MVP build.
