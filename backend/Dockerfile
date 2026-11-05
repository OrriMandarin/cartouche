# syntax=docker/dockerfile:1
# Build context: the repository root (docker build -f backend/Dockerfile .).
#
#   docker build -f backend/Dockerfile -t cartouche-api .                          # production image
#   docker build -f backend/Dockerfile --build-arg FEATURES=test-support -t ... .  # test image
#
# FEATURES is a space or comma separated list of Cargo features. Without `test-support` the
# resulting binary contains no /api/test/* routes and the image has no seed binary.

FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY backend/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
ARG FEATURES=""
COPY --from=planner /app/recipe.json recipe.json
# Dependencies only: this layer is cached until Cargo.toml / Cargo.lock change.
RUN cargo chef cook --release -p cartouche-api ${FEATURES:+--features "$FEATURES"} --recipe-path recipe.json
COPY backend/ .
RUN cargo build --release -p cartouche-api ${FEATURES:+--features "$FEATURES"} \
    && mkdir /out \
    && cp target/release/cartouche-api /out/ \
    && case "$FEATURES" in *test-support*) cp target/release/cartouche-seed /out/ ;; esac

FROM debian:bookworm-slim AS runtime
# ffmpeg (with ffprobe and libx264) processes the header videos; the API refuses to start
# without it (MED-041).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin cartouche
COPY --from=builder /out/ /usr/local/bin/
# Local media storage (MEDIA_STORAGE=local): a directory the unprivileged user can write.
# Mount a volume here to keep media across container restarts.
RUN mkdir -p /data/media && chown cartouche /data/media
USER cartouche
# Migrations are embedded in the binary (sqlx::migrate!) and applied at startup.
ENV BIND_ADDR=0.0.0.0:8080
ENV MEDIA_LOCAL_DIR=/data/media
EXPOSE 8080
CMD ["cartouche-api"]
