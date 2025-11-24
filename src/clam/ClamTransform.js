"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClamTransform = void 0;
const stream_1 = require("stream");
class ClamTransform extends stream_1.Transform {
    constructor(options) {
        super(options);
        this._streaming = false;
        this._numChunks = 0;
        this._totalSize = 0;
    }
    _transform(chunk, encoding, callback) {
        if (!this._streaming) {
            this.push("zINSTREAM\0");
            this._streaming = true;
        }
        this._totalSize += chunk.length;
        const size = Buffer.alloc(4);
        size.writeInt32BE(chunk.length, 0);
        this.push(size);
        this.push(chunk);
        this._numChunks += 1;
        callback();
    }
    _flush(callback) {
        const rState = this._readableState;
        if (rState && !rState.ended) {
            const size = Buffer.alloc(4);
            size.writeInt32BE(0, 0);
            this.push(size);
        }
        callback();
    }
}
exports.ClamTransform = ClamTransform;
