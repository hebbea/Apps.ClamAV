"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClamAVService = void 0;
const net = require("net");
const stream_1 = require("stream");
const ClamTransform_1 = require("./ClamTransform");
class ClamAVService {
    constructor(settings, logger) {
        this.settings = settings;
        this.logger = logger;
        this.debugLabel = 'node-clam';
        this.settings = settings;
        this.logger = logger;
    }
    _processResult(result, file = null) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        let timeout = false;
        if (typeof result !== 'string') {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Invalid stdout from scanner (not a string): `, result);
            return new Error('Invalid result to process (not a string)');
        }
        result = result.trim();
        if (/:\s+OK(\u0000|[\r\n])?$/.test(result)) {
            return {
                isInfected: false,
                viruses: [],
                file,
                resultString: result,
                timeout,
            };
        }
        if (/:\s+(.+)FOUND(\u0000|[\r\n])?/gm.test(result)) {
            (_b = this.logger) === null || _b === void 0 ? void 0 : _b.log(`${this.debugLabel}: Scan Response: `, result);
            (_c = this.logger) === null || _c === void 0 ? void 0 : _c.log(`${this.debugLabel}: File is INFECTED!`);
            const viruses = Array.from(new Set(result
                .split(/(\u0000|[\r\n])/)
                .map((v) => {
                return /:\s+(.+)FOUND$/gm.test(v)
                    ? v.replace(/(.+:\s+)(.+)FOUND/gm, '$2').trim()
                    : null;
            })
                .filter((v) => !!v)));
            return {
                isInfected: true,
                viruses,
                file,
                resultString: result,
                timeout,
            };
        }
        if (/^(.+)ERROR(\u0000|[\r\n])?/gm.test(result)) {
            const error = result.replace(/^(.+)ERROR/gm, '$1').trim();
            (_d = this.logger) === null || _d === void 0 ? void 0 : _d.error(`${this.debugLabel}: Error Response: `, error);
            (_e = this.logger) === null || _e === void 0 ? void 0 : _e.error(`${this.debugLabel}: File may be INFECTED!`);
            return new Error(`An error occurred while scanning the piped-through stream: ${error}`);
        }
        if (result === 'COMMAND READ TIMED OUT') {
            timeout = true;
            (_f = this.logger) === null || _f === void 0 ? void 0 : _f.error(`${this.debugLabel}: Scanning file has timed out. Message: `, result);
            (_g = this.logger) === null || _g === void 0 ? void 0 : _g.error(`${this.debugLabel}: File may be INFECTED!`);
            return {
                isInfected: null,
                viruses: [],
                file,
                resultString: result,
                timeout,
            };
        }
        (_h = this.logger) === null || _h === void 0 ? void 0 : _h.error(`${this.debugLabel}: Error Response: `, result);
        (_j = this.logger) === null || _j === void 0 ? void 0 : _j.error(`${this.debugLabel}: File may be INFECTED!`);
        return {
            isInfected: null,
            viruses: [],
            file,
            resultString: result,
            timeout,
        };
    }
    _initSocket() {
        return new Promise((resolve, reject) => {
            let client;
            const timeout = this.settings.timeout || 5000;
            if (this.settings.port && this.settings.host) {
                client = net.createConnection({
                    host: this.settings.host,
                    port: this.settings.port,
                    timeout,
                });
            }
            else {
                throw new Error('Unable to establish connection to clamd service: No socket or host/port combo provided!');
            }
            if (this.settings.timeout) {
                client.setTimeout(this.settings.timeout);
            }
            client
                .on('connect', () => {
                return resolve(client);
            })
                .on('timeout', () => {
                var _a;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Socket/Host connection timed out.`);
                reject(new Error('Connection to host has timed out.'));
                client.end();
            })
                .on('error', (e) => {
                var _a;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Socket/Host connection failed:`, e);
                reject(e);
            });
        });
    }
    scanStream(stream, file) {
        return new Promise(async (resolve, reject) => {
            let finished = false;
            let rejected = false;
            if (!this.settings.port && !this.settings.host) {
                return reject(new Error('Invalid info to connect to clamav service. A unix socket or port (w/ host) is required!'));
            }
            let socket;
            let transform;
            const cleanup = () => {
                if (transform && !transform.destroyed) {
                    transform.destroy();
                }
                if (socket && !socket.destroyed) {
                    socket.destroy();
                }
                if (stream && !stream.destroyed && stream.readable) {
                    stream.destroy();
                }
            };
            const safeReject = (error) => {
                if (!rejected) {
                    rejected = true;
                    cleanup();
                    reject(error);
                }
            };
            try {
                transform = new ClamTransform_1.ClamTransform({});
                socket = await this._initSocket();
                transform
                    .on('data', (data) => {
                    if (socket && !socket.destroyed) {
                        socket.write(data);
                    }
                })
                    .on('error', (err) => {
                    var _a;
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Transform stream error: `, err);
                    safeReject(err);
                });
                stream
                    .on('data', (data) => {
                    if (transform && !transform.destroyed) {
                        transform.write(data);
                    }
                })
                    .on('end', () => {
                    finished = true;
                    if (transform && !transform.destroyed) {
                        transform.end();
                    }
                })
                    .on('error', (err) => {
                    var _a;
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Error from input stream (perhaps the uploader closed the browser?)`, err);
                    safeReject(err);
                });
                const chunks = [];
                socket
                    .on('data', (chunk) => {
                    if (stream && !stream.destroyed && !stream.isPaused()) {
                        stream.pause();
                    }
                    chunks.push(chunk);
                })
                    .on('close', (hadError) => {
                    var _a;
                    if (hadError) {
                        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: ClamAV socket closed due to an error.`);
                    }
                })
                    .on('error', (err) => {
                    var _a;
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.error(`${this.debugLabel}: Socket error: `, err);
                    safeReject(err);
                })
                    .on('end', () => {
                    if (rejected) {
                        return;
                    }
                    cleanup();
                    const response = Buffer.concat(chunks);
                    if (!finished) {
                        return reject(new Error(`Scan aborted. Reply from server: ${response.toString('utf8')}`));
                    }
                    const result = this._processResult(response.toString('utf8'), file);
                    if (result instanceof Error) {
                        return reject(result);
                    }
                    return resolve(result);
                });
            }
            catch (err) {
                safeReject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }
    async scanBuffer(buffer, fileName) {
        const stream = new stream_1.PassThrough();
        stream.end(buffer);
        return this.scanStream(stream, fileName);
    }
    async ping() {
        const res = await this.command('zPING\0');
        return res.equals(Buffer.from('PONG\0'));
    }
    async version() {
        const res = await this.command('zVERSION\0');
        return res.toString();
    }
    async command(command) {
        const client = await this._initSocket();
        client.write(command);
        return new Promise((resolve, reject) => {
            const replies = [];
            client
                .on('data', function (chunk) {
                replies.push(chunk);
            })
                .on('end', function () {
                resolve(Buffer.concat(replies));
            })
                .on('error', reject);
        });
    }
}
exports.ClamAVService = ClamAVService;
