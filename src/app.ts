import "core-js";
import { createJsonRpcServer } from "./jsonrpc";
import { Response } from "./utils";

const server = createJsonRpcServer();

export async function main(body) {
  const result = await server.receive(body);
  if (result) {
    if (result.error) {
      if ([-32600, -32601, -32602, -32700].includes(result.error.code)) {
        return new Response(400, result);
      }
      return new Response(400, result);
    }
    return result;
  } else {
    return new Response(204, "");
  }
}

// vim: sw=2:ts=2:expandtab:fdm=syntax
