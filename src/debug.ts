import * as debug from "debug";

export function createDebug(name: string) {
  if (!process.env.LOG_JSON) {
    return debug(name);
  }
  const isEnabled = debug.enabled(name);
  return (...args) => {
    if (isEnabled) {
      console.debug(...args, { source: name });
    }
  };
}
