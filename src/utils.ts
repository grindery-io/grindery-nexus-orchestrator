import express from "express";
import _ from "lodash";

export class Response<T> {
  _code: number;
  _resp: T;
  constructor(code: number, resp: T) {
    this._code = code;
    this._resp = resp;
  }
  sendResponse(res: express.Response) {
    if (this._code === 204) {
      res.status(204).send();
    }
    return res.status(this._code).json(this._resp);
  }
}

export function replaceTokens<T>(obj: T, context: { [key: string]: unknown }): T {
  if (typeof obj === "string") {
    return obj.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_original, key) =>
      String((_.get(context, key, "") as string) ?? "")
    ) as unknown as T;
  }
  if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map((item) => replaceTokens(item, context)) as unknown as T;
    }
    return Object.entries(obj).reduce((acc, [key, value]) => {
      acc[key] = replaceTokens(value, context);
      return acc;
    }, {} as T);
  }
  return obj;
}
// vim: sw=2:ts=2:expandtab:fdm=syntax
