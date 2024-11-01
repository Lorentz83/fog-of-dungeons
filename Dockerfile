FROM golang:1.23.2-alpine3.20 AS build

RUN apk update && apk add npm && rm -rf /var/cache/apk/*
RUN npm install -g typescript

RUN adduser -h /home/srv -s /bin/sh -D srv
USER srv

COPY --chown=srv . /home/srv/src

RUN cd /home/srv/src/ts && tsc && cd /home/srv/src/go && go build -o fog-of-dungeons

FROM alpine:3.20
RUN adduser -H -h /opt -s /bin/sh -D srv
USER srv

COPY --from=build --chown=srv /home/srv/src/go/fog-of-dungeons /bin
EXPOSE 8080/tcp

CMD [ "/bin/fog-of-dungeons", "--listen=:8080" ]

