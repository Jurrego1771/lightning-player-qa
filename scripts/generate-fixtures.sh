#!/usr/bin/env bash
# generate-fixtures.sh — Genera streams HLS de test con ffmpeg
#
# Crea streams locales deterministas para tests de integración, visual y a11y.
# No dependen de CDN ni de la plataforma Mediastream.
#
# Inspirado en: Shaka Player (test/test/assets/*), dash.js (test/functional/content/)
#
# Uso:
#   bash scripts/generate-fixtures.sh
#
# Requiere: ffmpeg >= 4.0
# Resultado: fixtures/streams/vod/, fixtures/streams/audio/

set -e

STREAMS_DIR="fixtures/streams"
SEGMENT_DURATION=2

echo ""
echo "════════════════════════════════════════════"
echo "  Lightning Player QA — Fixture Generator"
echo "════════════════════════════════════════════"
echo ""

# ── Verificar ffmpeg ──────────────────────────────────────────────────────────
if ! command -v ffmpeg &> /dev/null; then
  echo "❌ ffmpeg no encontrado. Instalarlo desde https://ffmpeg.org/download.html"
  exit 1
fi
echo "✅ ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
echo ""

# ── VOD Multi-bitrate (360p + 720p, ~8 segundos) ──────────────────────────────
echo "📹 Generando VOD multi-bitrate (~8s, 2 calidades)..."

mkdir -p "$STREAMS_DIR/vod/360p"
mkdir -p "$STREAMS_DIR/vod/720p"

# 360p — baja calidad (~400 Kbps)
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=8:size=640x360:rate=24" \
  -f lavfi -i "sine=frequency=440:duration=8" \
  -c:v libx264 -preset ultrafast -b:v 350k -maxrate 420k -bufsize 840k \
  -c:a aac -b:a 64k -ar 44100 \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -f hls \
  -hls_time $SEGMENT_DURATION \
  -hls_list_size 0 \
  -hls_flags independent_segments \
  -hls_segment_filename "$STREAMS_DIR/vod/360p/segment%03d.ts" \
  "$STREAMS_DIR/vod/360p/index.m3u8"

echo "  ✅ 360p OK"

# 720p — alta calidad (~1.5 Mbps)
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=8:size=1280x720:rate=24" \
  -f lavfi -i "sine=frequency=880:duration=8" \
  -c:v libx264 -preset ultrafast -b:v 1400k -maxrate 1680k -bufsize 3360k \
  -c:a aac -b:a 128k -ar 44100 \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -f hls \
  -hls_time $SEGMENT_DURATION \
  -hls_list_size 0 \
  -hls_flags independent_segments \
  -hls_segment_filename "$STREAMS_DIR/vod/720p/segment%03d.ts" \
  "$STREAMS_DIR/vod/720p/index.m3u8"

echo "  ✅ 720p OK"

# Master playlist con ambas calidades
cat > "$STREAMS_DIR/vod/master.m3u8" << 'EOF'
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=414000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",NAME="360p"
360p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1528000,RESOLUTION=1280x720,CODECS="avc1.42c01f,mp4a.40.2",NAME="720p"
720p/index.m3u8
EOF

echo "  ✅ master.m3u8 OK"
echo ""

# ── VOD Audio only (MP3-like via AAC) ────────────────────────────────────────
echo "🎵 Generando stream de audio (~8s)..."

mkdir -p "$STREAMS_DIR/audio"

ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=440:duration=8" \
  -c:a aac -b:a 128k -ar 44100 \
  -f hls \
  -hls_time $SEGMENT_DURATION \
  -hls_list_size 0 \
  -hls_flags independent_segments \
  -hls_segment_filename "$STREAMS_DIR/audio/segment%03d.ts" \
  "$STREAMS_DIR/audio/index.m3u8"

echo "  ✅ audio/index.m3u8 OK"
echo ""

# ── VOD con error en segmento (para tests de recovery) ───────────────────────
echo "💥 Generando stream con segmento faltante (error recovery)..."

mkdir -p "$STREAMS_DIR/vod-with-error"

# Reusar los segmentos del 360p pero crear un playlist que referencia uno inexistente
cat > "$STREAMS_DIR/vod-with-error/index.m3u8" << 'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.000000,
../vod/360p/segment000.ts
#EXTINF:2.000000,
MISSING_SEGMENT.ts
#EXTINF:2.000000,
../vod/360p/segment002.ts
#EXT-X-ENDLIST
EOF

echo "  ✅ vod-with-error/index.m3u8 OK"
echo ""

# ── Resumen ───────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════"
echo "  ✅ Fixtures generados en: $STREAMS_DIR/"
echo ""
echo "  Streams disponibles:"
echo "  • VOD HLS multi-bitrate: vod/master.m3u8"
echo "  • Audio HLS:             audio/index.m3u8"
echo "  • Error recovery:        vod-with-error/index.m3u8"
echo ""
echo "  Para servir localmente:"
echo "  npx serve $STREAMS_DIR -p 9001 --cors"
echo ""
echo "  Luego acceder en:"
echo "  http://localhost:9001/vod/master.m3u8"
echo "════════════════════════════════════════════"
echo ""
