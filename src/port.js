// The transport of the worker mode: anything that posts structured-clone
// messages. A browser Worker, a MessagePort, the worker's own global scope,
// and node's worker_threads Worker, MessagePort and parentPort all qualify.

/**
 * A message endpoint.
 * @typedef {object} Port
 * @property {(message: any, transfer: any[]) => void} postMessage Called with a transfer list, empty when nothing transfers.
 * @property {((type: 'message', listener: (event: { data: any }) => void) => void)=} addEventListener
 * @property {((type: 'message', listener: (event: { data: any }) => void) => void)=} removeEventListener
 * @property {((type: 'message', listener: (data: any) => void) => any)=} on EventEmitter style (node's worker_threads Worker)
 * @property {((type: 'message', listener: (data: any) => void) => any)=} off
 * @property {(() => void)=} start
 */

/** The transfer list of a message that transfers nothing. @type {any[]} */
export const NOTHING = [];

/**
 * The worker wire's version, the same in worker.js and remote.js of one
 * ren-core: the main thread sends it in its first message (ROOT) and the
 * worker answers with its own (VERSION), so each side refuses the other
 * when they differ. It changes with any change to the messages or records.
 */
export const PROTOCOL = 3;

/**
 * The error of a side whose peer speaks another wire version.
 * @param {string} side 'REN worker' or 'REN remote' @param {string} peer @param {any} theirs
 */
export const mismatch = (side, peer, theirs) =>
  new Error(`${side}: the ${peer} speaks worker protocol ${typeof theirs === 'number' ? theirs : 'none'}, this side ${PROTOCOL}; build the page and the worker from one ren-core`);

/**
 * Receives every message of `port` in `receive`; returns the function that
 * stops. `before` runs first, before the message is read (a browser
 * deserializes `data` when it is first read), so a clock can include it.
 * @param {Port} port @param {(data: any) => void} receive @param {(() => void) | null} [before]
 * @returns {() => void}
 */
export function subscribe(port, receive, before = null) {
  if (typeof port.addEventListener === 'function') {
    /** @type {(event: { data: any }) => void} */
    const listener =
      before === null
        ? event => receive(event.data)
        : event => {
            before();
            receive(event.data);
          };
    port.addEventListener('message', listener);
    if (typeof port.start === 'function') port.start();
    return () => {
      if (typeof port.removeEventListener === 'function') port.removeEventListener('message', listener);
    };
  }
  if (typeof port.on === 'function') {
    /** @type {(data: any) => void} */
    const listener =
      before === null
        ? receive
        : data => {
            before();
            receive(data);
          };
    port.on('message', listener);
    return () => {
      if (typeof port.off === 'function') port.off('message', listener);
    };
  }
  throw new TypeError('REN: a port needs addEventListener or on');
}
