'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCleanReply = exports.version = exports.ping = exports.createScanner = void 0;
const buffer_1 = require("buffer");
const net = require("net");
const stream_1 = require("stream");
function createScanner(host, port) {
    if (!host || !port) {
        throw new Error('must provide the host and port that clamav server listen to');
    }
    function scanStream(readStream, timeout) {
        if (typeof timeout === 'undefined' || timeout < 0) {
            timeout = 5000;
        }
        return new Promise(function (resolve, reject) {
            let readFinished = false;
            const socket = net.createConnection({
                host,
                port,
            }, function () {
                socket.write('zINSTREAM\0');
                readStream.pipe(chunkTransform()).pipe(socket);
                readStream
                    .on('end', function () {
                    readFinished = true;
                    readStream.destroy();
                })
                    .on('error', reject);
            });
            const replies = [];
            socket.setTimeout(timeout);
            socket
                .on('data', function (chunk) {
                if (!readStream.isPaused()) {
                    readStream.pause();
                }
                replies.push(chunk);
            })
                .on('end', function () {
                const reply = buffer_1.Buffer.concat(replies);
                if (!readFinished) {
                    reject(new Error('Scan aborted. Reply from server: ' + reply));
                }
                else {
                    resolve(reply.toString());
                }
            })
                .on('error', reject);
        });
    }
    function scanBuffer(buffer, timeout, chunkSize) {
        if (typeof timeout !== 'number' || timeout < 0) {
            timeout = 5000;
        }
        if (typeof chunkSize !== 'number') {
            chunkSize = 64 * 1024;
        }
        let start = 0;
        const bufReader = new stream_1.Readable({
            highWaterMark: chunkSize,
            read(size) {
                if (start < buffer.length) {
                    const block = buffer.slice(start, start + size);
                    this.push(block);
                    start += block.length;
                }
                else {
                    this.push(null);
                }
            },
        });
        return scanStream(bufReader, timeout);
    }
    return {
        scanStream,
        scanBuffer,
    };
}
exports.createScanner = createScanner;
async function ping(host, port, timeout) {
    if (!host || !port) {
        throw new Error('must provide the host and port that clamav server listen to');
    }
    if (typeof timeout !== 'number' || timeout < 0) {
        timeout = 5000;
    }
    const res = await _command(host, port, timeout, 'zPING\0');
    return res.equals(buffer_1.Buffer.from('PONG\0'));
}
exports.ping = ping;
async function version(host, port, timeout) {
    if (!host || !port) {
        throw new Error('must provide the host and port that clamav server listen to');
    }
    if (typeof timeout !== 'number' || timeout < 0) {
        timeout = 5000;
    }
    const res = await _command(host, port, timeout, 'zVERSION\0');
    return res.toString();
}
exports.version = version;
function isCleanReply(reply) {
    return !reply.includes('FOUND');
}
exports.isCleanReply = isCleanReply;
function chunkTransform() {
    return new stream_1.Transform({
        transform(chunk, encoding, callback) {
            const length = buffer_1.Buffer.alloc(4);
            length.writeUInt32BE(chunk.length, 0);
            this.push(length);
            this.push(chunk);
            callback();
        },
        flush(callback) {
            const zore = buffer_1.Buffer.alloc(4);
            zore.writeUInt32BE(0, 0);
            this.push(zore);
            callback();
        },
    });
}
function _command(host, port, timeout, command) {
    return new Promise(function (resolve, reject) {
        const client = net.createConnection({
            host,
            port,
        }, function () {
            client.write(command);
        });
        client.setTimeout(timeout);
        const replies = [];
        client
            .on('data', function (chunk) {
            replies.push(chunk);
        })
            .on('end', function () {
            resolve(buffer_1.Buffer.concat(replies));
        })
            .on('error', reject);
    });
}
