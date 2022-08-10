import * as debug from "debug";

export function createDebug(name: string) {
  if (!process.env.LOG_JSON) {
    return debug(name);
  }
  return (...args) => {
    if (debug.enabled(name)) {
      console.log(...args, { source: name });
    }
  };
}
