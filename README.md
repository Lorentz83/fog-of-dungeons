# Fog of Dungeons

Fog of Doungeons is a web service that implements a
<a href="https://en.wikipedia.org/wiki/Fog_of_war">fog of war</a>
for tabletop role-playing game like Dungeons & Dragons.

The game master can share a map which is initially covered by a thick
layer of fog and, while the game unroll, slowly clear the explored portions of the map.

## Install

This is a client server project, the server can be hosted anywhere (it
has been tested on Linux and MacOS, but it should work on Windows too).
Master and players just need a browser to connet and use it.

The software is written in Typescript and GO. First you need to compile
the typescript files in `./ts`, it generates the javascript files
which will embedded later in the go code in `./go`.

Assuming that you have installed `tsc` globally and that you have the
go toolchain installed, you can simply run `./local-build.sh`.

Alternatively, you can run `./build-docker.sh` which will create a
local image, and execute it with
`docker run -p 8080:8080 lorentz83/fog-of-dungeons:latest`.

Once the server is running, just point your browser to
http://localhost:8080.
Please note that if you want to share the map with the players you
shuld use your IP address instead of localhost, and likely have the
players connected to the same network.

## Known issues

This project is the result of some fun cowboy codeing done during a vacation.
It still needs be buttle tested, but I'm already aware of a few
limitations:

- It only works with modern browsers.
  - Last versin of Firefox, Chrome (and derivates) work both on mobile
    and pc.
  - Safari doesn't apply blur borders when removing fog (master only).
  - Many embedded Android browsers don't work and may not report errors
    correctly.
- Sometime the image is not loaded on the player side (a browser
  refresh usually fixes it).

## TODO

Not in any specific order:

- Document command line flags.
- Wire extra command line flags in Docker image.
- Add tests.
- Document the protocol between client and server.
- Publish the docker image on some public repository.
- Improve UX.
  - When the player enters in fullscreen, the map should rotate to match
    the display orientation.
  - Despite the master can work on mobile too, touch actions remove
    the fog, pinch actions move and zoom the map. This is not easy to
    discover or use.
- Add privacy policy page and links to github project.
- Add the license header in the files.
- Migrate from client-server protocol to p2p using websockets.
- Consider if hosting a public instance.
  - Check resource requirements.
  - Get some better ideas of scalability.
  - Consider how to protect from abuses.
  - More likely to happen after switching to p2p protocol.
