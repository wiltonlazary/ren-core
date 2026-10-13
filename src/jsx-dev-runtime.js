// The JSX automatic development runtime.
import { jsx } from './core.js';
export { Fragment } from './core.js';

/**
 * @param {any} type
 * @param {any} props
 * @param {any} [key]
 * @returns {any}
 */
export function jsxDEV(type, props, key) {
  return jsx(type, props, key);
}
