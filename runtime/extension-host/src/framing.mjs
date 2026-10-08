// Native-messaging / native-pipe framing, byte for byte.
//
// Evidence (see HOST-PROPIO-SPEC.md §2):
//   * browser <-> host  : Chrome native messaging = uint32 (little endian) payload length
//                         followed by UTF-8 JSON. Header length == 4, header NOT included
//                         in the length. No marker byte, no NUL terminator, no newline.
//                         Proven by the pre-existing smoke test (sendToHost) and by
//                         Chrome's documented native messaging protocol.
//   * host <-> runtime  : identical shape. Proven by browser-service.mjs:
//                           var wi = 4;                       // header size
//                           function N0(t, e) {               // encoder
//                             let r = Mu.from(t, "utf8");
//                             if (r.length > e) throw new ih(r.length, e);
//                             let n = Mu.alloc(wi + r.length);
//                             return Yee(n, r.length, 0), r.copy(n, wi), n;
//                           }
//                         where Yee = writeUInt32LE on little-endian hosts (os.endianness()).
//   * max frame size default in the runtime: 8 * 1024 * 1024 (S4e); the transport throws
//     "native pipe message exceeds frame limit" above it.
//
// This is a faithful, dependency-free re-implementation.
export const FRAME_HEADER_BYTES = 4;
export const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export class FrameTooLargeError extends Error {
  constructor(messageBytes, maxFrameBytes) {
    super(
      `native pipe message exceeds frame limit (${messageBytes} > ${maxFrameBytes} bytes)`,
    );
    this.name = "FrameTooLargeError";
    this.messageBytes = messageBytes;
    this.maxFrameBytes = maxFrameBytes;
  }
}

/** Encode a JS value (or an already-serialized string) into one frame. */
export function encodeFrame(value, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const payload = Buffer.from(text, "utf8");
  if (payload.length > maxFrameBytes) {
    throw new FrameTooLargeError(payload.length, maxFrameBytes);
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
}

/**
 * Incremental decoder. Feed arbitrary chunks, get back the complete JSON texts
 * that were fully received. Delimitation is purely by the 4-byte length prefix.
 */
export function createFrameDecoder({ maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
  let buffer = Buffer.alloc(0);
  return {
    get pendingBytes() {
      return buffer.length;
    },
    push(chunk) {
      if (chunk.length > 0) {
        buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      }
      const frames = [];
      for (;;) {
        if (buffer.length < FRAME_HEADER_BYTES) break;
        const size = buffer.readUInt32LE(0);
        if (size > maxFrameBytes) throw new FrameTooLargeError(size, maxFrameBytes);
        if (buffer.length < FRAME_HEADER_BYTES + size) break;
        frames.push(buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size).toString("utf8"));
        buffer = buffer.subarray(FRAME_HEADER_BYTES + size);
      }
      return frames;
    },
  };
}

/** Wire the decoder to a readable stream; cb(jsonText) for every complete frame. */
export function readFrames(stream, cb, options = {}) {
  const decoder = createFrameDecoder(options);
  stream.on("data", (chunk) => {
    for (const text of decoder.push(chunk)) cb(text);
  });
  stream.on("error", (err) => cb(null, err));
  return decoder;
}
