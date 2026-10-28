# syntax=docker/dockerfile:1
# Сборка официального source-only релиза, без сторонних образов MinIO.
FROM golang:1.25-alpine AS minio-build
WORKDIR /source
ADD https://github.com/minio/minio/archive/refs/tags/RELEASE.2025-10-15T17-29-55Z.tar.gz /tmp/minio.tar.gz
RUN tar -xzf /tmp/minio.tar.gz --strip-components=1 -C /source
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags='-s -w' -o /out/minio .

FROM golang:1.25-alpine AS mc-build
WORKDIR /source
ADD https://github.com/minio/mc/archive/refs/tags/RELEASE.2025-08-13T08-35-41Z.tar.gz /tmp/mc.tar.gz
RUN tar -xzf /tmp/mc.tar.gz --strip-components=1 -C /source
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags='-s -w' -o /out/mc .

FROM alpine:3.22 AS runtime
COPY --from=minio-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN mkdir -p /data && chown 10001:10001 /data
ENV HOME=/tmp
USER 10001:10001

FROM runtime AS minio
COPY --from=minio-build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

FROM runtime AS mc
COPY --from=mc-build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
